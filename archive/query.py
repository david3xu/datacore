#!/usr/bin/env python3
"""Query datacore events. Usage:
  python3 query.py                          # last 20 events
  python3 query.py --today                  # today's events
  python3 query.py --actor "ai:*"           # all AI messages
  python3 query.py --type message           # all messages
  python3 query.py --search "kaggle"        # full-text search
  python3 query.py --stats                  # summary stats
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timedelta

DB_PATH = Path(__file__).parent / "datacore.db"


def query(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return rows


def display(rows, max_text=120):
    for r in rows:
        ts = r["timestamp"][:19] if r["timestamp"] else "?"
        actor = (r["actor"] or "?")[:30]
        etype = (r["event_type"] or "?")[:12]
        text = (r["content_text"] or "")[:max_text].replace("\n", " ")
        print(f"  {ts}  [{etype:12}] {actor:30} {text}")


def stats():
    print("=== Datacore Stats ===")
    for label, sql in [
        ("Total events", "SELECT COUNT(*) FROM events"),
        ("Sources", "SELECT source, COUNT(*) c FROM events GROUP BY source ORDER BY c DESC"),
        ("Event types", "SELECT event_type, COUNT(*) c FROM events GROUP BY event_type ORDER BY c DESC"),
        ("Actors", "SELECT actor, COUNT(*) c FROM events GROUP BY actor ORDER BY c DESC"),
        ("Sessions", "SELECT COUNT(DISTINCT session_id) FROM events"),
        ("Date range", "SELECT MIN(timestamp), MAX(timestamp) FROM events"),
    ]:
        rows = query(sql)
        if len(rows) == 1 and len(rows[0]) == 1:
            print(f"  {label}: {rows[0][0]}")
        elif len(rows) == 1 and len(rows[0]) == 2:
            print(f"  {label}: {rows[0][0]} → {rows[0][1]}")
        else:
            print(f"  {label}:")
            for r in rows:
                vals = [str(r[i]) for i in range(len(r))]
                print(f"    {' | '.join(vals)}")


def main():
    args = sys.argv[1:]

    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        print("Run: python3 ingest/openclaw.py")
        sys.exit(1)

    if "--stats" in args:
        stats()
        return

    # Build query
    where = []
    params = []

    if "--today" in args:
        today = datetime.now().strftime("%Y-%m-%d")
        where.append("timestamp >= ?")
        params.append(today)

    if "--type" in args:
        i = args.index("--type") + 1
        where.append("event_type = ?")
        params.append(args[i])

    if "--actor" in args:
        i = args.index("--actor") + 1
        v = args[i]
        if "*" in v:
            where.append("actor LIKE ?")
            params.append(v.replace("*", "%"))
        else:
            where.append("actor = ?")
            params.append(v)

    if "--search" in args:
        i = args.index("--search") + 1
        where.append("content_text LIKE ?")
        params.append(f"%{args[i]}%")

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    limit = 20 if not any(a.startswith("--") for a in args) else 100
    sql = f"SELECT * FROM events {clause} ORDER BY timestamp DESC LIMIT {limit}"

    rows = query(sql, params)
    if rows:
        print(f"  ({len(rows)} events)")
        display(list(reversed(rows)))
    else:
        print("  No events found.")


if __name__ == "__main__":
    main()
