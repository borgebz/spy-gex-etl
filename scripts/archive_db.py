#!/usr/bin/env python3
"""Retention for spy_gex.db: delete old raw CBOE files, archive old option snapshots.

Rules
- raw_cboe_options_quotes: delete rows older than --raw-days (default 2), only when the
  file is already parsed into option_snapshot. Raw files are not archived.
- option_snapshot: for each market day older than --option-days (default 7), write every
  row of that day to <archive-dir>/options/YYYY-MM-DD.jsonl.gz, check the file, then delete
  the day's rows from the DB except the daily close (the latest file of the day's last
  market time, the same file 04-compute-gex uses).
- gex_snapshot, gex_strike, price_tick: never touched.

Deleting rows does not shrink the file. Use --vacuum (no other connection may be open).

Usage
  archive_db.py [--dry-run] [--vacuum] [--db PATH] [--archive-dir PATH]
                [--raw-days N] [--option-days N] [--now YYYY-MM-DDTHH:MM:SSZ]
"""
import argparse
import gzip
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(REPO, "workflow", "data", "spy_gex.db")
DEFAULT_ARCHIVE = os.path.join(REPO, "workflow", "data", "archive")
ISO = "%Y-%m-%dT%H:%M:%SZ"

# Latest file of the last market time of each day = the daily close kept in the DB.
DAILY_CLOSE_SQL = """
SELECT d.day, max(s.snapshot_ts_utc)
FROM (SELECT DISTINCT snapshot_ts_utc, market_ts_utc FROM option_snapshot) s
JOIN (SELECT date(market_ts_utc) AS day, max(market_ts_utc) AS last_market
      FROM (SELECT DISTINCT market_ts_utc FROM option_snapshot)
      GROUP BY date(market_ts_utc)) d
  ON s.market_ts_utc = d.last_market
GROUP BY d.day
"""


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--archive-dir", default=DEFAULT_ARCHIVE)
    p.add_argument("--raw-days", type=int, default=2)
    p.add_argument("--option-days", type=int, default=7)
    p.add_argument("--now", help="pretend it is this UTC time (for tests)")
    p.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    p.add_argument("--vacuum", action="store_true", help="shrink the DB file at the end")
    args = p.parse_args()
    if args.raw_days >= args.option_days:
        p.error("--raw-days must be smaller than --option-days (else 03 re-parses deleted options)")
    return args


def delete_raw(con, cutoff, dry_run):
    where = """snapshot_ts_utc < ?
               AND snapshot_ts_utc IN (SELECT DISTINCT snapshot_ts_utc FROM option_snapshot)"""
    n = con.execute(f"SELECT count(*) FROM raw_cboe_options_quotes WHERE {where}", (cutoff,)).fetchone()[0]
    if n and not dry_run:
        with con:
            con.execute(f"DELETE FROM raw_cboe_options_quotes WHERE {where}", (cutoff,))
    return n


def days_to_archive(con, cutoff_day):
    """Market days before cutoff_day that still hold rows other than their daily close."""
    closes = dict(con.execute(DAILY_CLOSE_SQL).fetchall())
    days = [d for (d,) in con.execute(
        "SELECT DISTINCT date(market_ts_utc) FROM option_snapshot WHERE date(market_ts_utc) < ? ORDER BY 1",
        (cutoff_day,))]
    pending = []
    for day in days:
        extra = con.execute(
            "SELECT count(*) FROM option_snapshot WHERE date(market_ts_utc) = ? AND snapshot_ts_utc <> ?",
            (day, closes[day])).fetchone()[0]
        if extra:
            pending.append((day, closes[day]))
    return pending


def db_size(path):
    """Main file plus WAL file: in WAL mode, recent changes live in the -wal file."""
    return sum(os.path.getsize(p) for p in (path, path + "-wal") if os.path.exists(p))


def count_lines(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return sum(1 for _ in f)


def archive_day(con, day, close_snapshot, archive_dir, dry_run):
    rows = con.execute(
        "SELECT * FROM option_snapshot WHERE date(market_ts_utc) = ? ORDER BY snapshot_ts_utc, option_symbol",
        (day,))
    cols = [c[0] for c in rows.description]
    rows = rows.fetchall()
    path = os.path.join(archive_dir, "options", f"{day}.jsonl.gz")
    if dry_run:
        return len(rows), path, "would write"

    if os.path.exists(path):
        # A previous run wrote the file but stopped before the delete: reuse it only if complete.
        if count_lines(path) != len(rows):
            raise SystemExit(f"{path} exists with a different row count; check it by hand")
        status = "file existed"
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as f:
            for r in rows:
                f.write(json.dumps(dict(zip(cols, r)), separators=(",", ":")) + "\n")
        if count_lines(tmp) != len(rows):
            os.remove(tmp)
            raise SystemExit(f"archive check failed for {day}; nothing deleted")
        os.replace(tmp, path)
        status = "written"

    with con:
        con.execute("DELETE FROM option_snapshot WHERE date(market_ts_utc) = ? AND snapshot_ts_utc <> ?",
                    (day, close_snapshot))
    return len(rows), path, status


def main():
    args = parse_args()
    now = datetime.strptime(args.now, ISO).replace(tzinfo=timezone.utc) if args.now else datetime.now(timezone.utc)
    raw_cutoff = (now - timedelta(days=args.raw_days)).strftime(ISO)
    option_cutoff_day = (now - timedelta(days=args.option_days)).strftime("%Y-%m-%d")

    con = sqlite3.connect(args.db, timeout=30)
    con.execute("PRAGMA busy_timeout = 30000")
    mode = "DRY RUN — " if args.dry_run else ""
    print(f"{mode}db {args.db}")

    n = delete_raw(con, raw_cutoff, args.dry_run)
    print(f"raw files before {raw_cutoff}: {n} {'to delete' if args.dry_run else 'deleted'}")

    for day, close in days_to_archive(con, option_cutoff_day):
        n, path, status = archive_day(con, day, close, args.archive_dir, args.dry_run)
        print(f"options {day}: {n} rows → {path} ({status}); kept daily close {close}")

    if args.vacuum and not args.dry_run:
        before = db_size(args.db)
        con.execute("VACUUM")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # WAL mode: the main file shrinks only here
        print(f"vacuum: {before / 1e6:.1f} MB → {db_size(args.db) / 1e6:.1f} MB")
    con.close()


if __name__ == "__main__":
    sys.exit(main())
