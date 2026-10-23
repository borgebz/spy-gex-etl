# scripts

## archive_db.py

Keeps `workflow/data/spy_gex.db` small.

- Deletes raw CBOE files older than 2 days (only when already parsed).
- Archives option snapshots older than 7 days to `workflow/data/archive/options/YYYY-MM-DD.jsonl.gz`, then deletes them from the DB. The last snapshot of each day stays in the DB.
- Does not touch GEX, strike or price data.

Run it once a day, after the market close:

```bash
python3 scripts/archive_db.py --vacuum
```

To see what it would do, without changes:

```bash
python3 scripts/archive_db.py --dry-run
```
