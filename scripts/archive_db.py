#!/usr/bin/env python3
"""Retention for spy_gex.db: delete old raw CBOE files, archive old option snapshots to Parquet.

Rules
- raw_cboe_options_quotes: delete rows older than --raw-days (default 2), only when the
  file is already parsed into option_snapshot. Raw files are not archived.
- option_snapshot: for each market day older than --option-days (default 7), write every
  row of that day to <archive-dir>/options/date=YYYY-MM-DD/part.parquet (zstd), check the
  file, then delete the day's rows from the DB except the daily close (the latest file of the
  day's last market time, the same file 04-compute-gex uses).
- gex_snapshot, gex_strike, price_tick: never touched.

The archive is Hive-partitioned: DuckDB, polars and Spark read `date` from the folder name, e.g.
  SELECT * FROM read_parquet('archive/options/*/*.parquet', hive_partitioning = true)

Deleting rows does not shrink the file. Use --vacuum (no other connection may be open).

Needs DuckDB: pip install -r scripts/requirements.txt (the first run also downloads
DuckDB's sqlite extension).

Usage
  archive_db.py [--dry-run] [--vacuum] [--db PATH] [--archive-dir PATH]
                [--raw-days N] [--option-days N] [--now YYYY-MM-DDTHH:MM:SSZ]
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

try:
    import duckdb
except ImportError:
    sys.exit("duckdb is missing: pip install -r scripts/requirements.txt")

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

# Typed columns; sorted so similar values sit together (better compression, readers can skip blocks).
EXPORT_SQL = """
SELECT strptime(snapshot_ts_utc, '%Y-%m-%dT%H:%M:%SZ')::TIMESTAMPTZ AS snapshot_ts_utc,
       strptime(market_ts_utc,   '%Y-%m-%dT%H:%M:%SZ')::TIMESTAMPTZ AS market_ts_utc,
       option_symbol,
       expiry::DATE           AS expiry,
       type,
       strike::DOUBLE         AS strike,
       spot::DOUBLE           AS spot,
       gamma::DOUBLE          AS gamma,
       open_interest::INTEGER AS open_interest,
       iv::DOUBLE             AS iv,
       delta::DOUBLE          AS delta,
       volume::INTEGER        AS volume
FROM src.option_snapshot
WHERE date(market_ts_utc) = $day
ORDER BY snapshot_ts_utc, expiry, strike, type
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


def open_duckdb(db_path):
    duck = duckdb.connect()
    duck.execute("INSTALL sqlite; LOAD sqlite; SET TimeZone = 'UTC';")
    duck.execute(f"ATTACH '{db_path}' AS src (TYPE sqlite, READ_ONLY)")
    return duck


def parquet_fingerprint(duck, path):
    """Row count and total open interest: compared with SQLite before any delete."""
    return tuple(duck.execute(
        "SELECT count(*), coalesce(sum(open_interest), 0) FROM read_parquet($p)", {"p": path}).fetchone())


def archive_day(con, duck, day, close_snapshot, archive_dir, dry_run):
    expected = con.execute(
        "SELECT count(*), coalesce(sum(open_interest), 0) FROM option_snapshot WHERE date(market_ts_utc) = ?",
        (day,)).fetchone()
    path = os.path.join(archive_dir, "options", f"date={day}", "part.parquet")
    if dry_run:
        return expected[0], path, "would write"

    if os.path.exists(path):
        # A previous run wrote the file but stopped before the delete: reuse it only if complete.
        if parquet_fingerprint(duck, path) != tuple(expected):
            raise SystemExit(f"{path} exists but does not match the DB; check it by hand")
        status = "file existed"
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        duck.execute(f"COPY ({EXPORT_SQL}) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)", {"day": day})
        if parquet_fingerprint(duck, tmp) != tuple(expected):
            os.remove(tmp)
            raise SystemExit(f"archive check failed for {day}; nothing deleted")
        os.replace(tmp, path)
        status = f"written, {os.path.getsize(path) / 1e6:.2f} MB"

    with con:
        con.execute("DELETE FROM option_snapshot WHERE date(market_ts_utc) = ? AND snapshot_ts_utc <> ?",
                    (day, close_snapshot))
    return expected[0], path, status


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

    pending = days_to_archive(con, option_cutoff_day)
    if pending:
        duck = open_duckdb(args.db)
        try:
            for day, close in pending:
                n, path, status = archive_day(con, duck, day, close, args.archive_dir, args.dry_run)
                print(f"options {day}: {n} rows → {path} ({status}); kept daily close {close}")
        finally:
            duck.close()   # release the read connection before VACUUM

    if args.vacuum and not args.dry_run:
        before = db_size(args.db)
        con.execute("VACUUM")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # WAL mode: the main file shrinks only here
        print(f"vacuum: {before / 1e6:.1f} MB → {db_size(args.db) / 1e6:.1f} MB")
    con.close()


if __name__ == "__main__":
    sys.exit(main())
