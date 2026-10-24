# scripts

## archive_db.py

Keeps `workflow/data/spy_gex.db` small.

- Deletes raw CBOE files older than 2 days (only when already parsed).
- Archives option snapshots older than 7 days to Parquet (zstd), one file per day:
  `workflow/data/archive/options/date=YYYY-MM-DD/part.parquet`. Then deletes them from the DB.
  The last snapshot of each day stays in the DB.
- Does not touch GEX, strike or price data.

Set up once:

```bash
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
```

Run it once a day, after the market close:

```bash
scripts/.venv/bin/python scripts/archive_db.py --vacuum
```

To see what it would do, without changes:

```bash
scripts/.venv/bin/python scripts/archive_db.py --dry-run
```

Read the archive with DuckDB:

```sql
SELECT * FROM read_parquet('workflow/data/archive/options/*/*.parquet', hive_partitioning = true);
```
