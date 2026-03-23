#!/usr/bin/env python3
"""Ingest OpenClaw sessions into datacore SQLite."""

import json
import sqlite3
import uuid
import os
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "datacore.db"
SESSIONS_DIR = Path.home() / ".openclaw" / "agents" / "main" / "sessions"


def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id            TEXT PRIMARY KEY,
            timestamp     TEXT NOT NULL,
            source        TEXT NOT NULL,
            source_id     TEXT,
            session_id    TEXT,
            parent_id     TEXT,
            actor         TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            content_text  TEXT,
            content_json  TEXT,
            metadata      TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON events(source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_session ON events(session_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_actor ON events(actor)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_type ON events(event_type)")
    conn.commit()
    return conn


def extract_text(content):
    """Extract plain text from OpenClaw message content array."""
    if isinstance(content, str):
        return content
    texts = []
    for block in (content or []):
        if isinstance(block, dict) and block.get("type") == "text":
            texts.append(block.get("text", ""))
    return "\n".join(texts) if texts else None


def resolve_actor(event, session_meta):
    """Determine who produced this event."""
    etype = event.get("type")
    if etype == "message":
        role = event.get("message", {}).get("role", "")
        if role == "user":
            return "david"
        elif role == "assistant":
            p = session_meta.get("provider", "unknown")
            m = session_meta.get("model", "unknown")
            return f"ai:{p}/{m}"
        elif role == "toolResult":
            return "system"
    return "system"


def map_event_type(event):
    """Map OpenClaw event type to datacore event_type."""
    etype = event.get("type")
    if etype == "message":
        role = event.get("message", {}).get("role", "")
        if role == "toolResult":
            return "tool_result"
        return "message"
    if etype == "session":
        return "session_start"
    if etype in ("model_change", "thinking_level_change"):
        return "config"
    if etype == "custom":
        return "metadata"
    return etype or "unknown"


def ingest_session(conn, jsonl_path):
    """Ingest one OpenClaw session JSONL file."""
    session_id = jsonl_path.stem  # uuid from filename
    session_meta = {"provider": "unknown", "model": "unknown"}
    inserted = 0
    skipped = 0

    with open(jsonl_path) as f:
        for line in f:
            event = json.loads(line.strip())

            # Track model for actor resolution
            if event.get("type") == "model_change":
                session_meta["provider"] = event.get("provider", "unknown")
                session_meta["model"] = event.get("modelId", "unknown")
            if event.get("type") == "custom" and event.get("customType") == "model-snapshot":
                data = event.get("data", {})
                session_meta["provider"] = data.get("provider", session_meta["provider"])
                session_meta["model"] = data.get("modelId", session_meta["model"])

            # Build the common event
            source_id = event.get("id")
            content_text = None
            if event.get("type") == "message":
                msg = event.get("message", {})
                content_text = extract_text(msg.get("content"))

            row = (
                str(uuid.uuid4()),
                event.get("timestamp", ""),
                "openclaw",
                source_id,
                session_id,
                event.get("parentId"),
                resolve_actor(event, session_meta),
                map_event_type(event),
                content_text,
                json.dumps(event.get("message")) if event.get("type") == "message" else None,
                json.dumps(session_meta),
            )

            try:
                conn.execute(
                    "INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?)", row
                )
                inserted += 1
            except sqlite3.IntegrityError:
                skipped += 1

    conn.commit()
    return inserted, skipped


def main():
    db = init_db(DB_PATH)
    total_inserted = 0
    total_skipped = 0

    if not SESSIONS_DIR.exists():
        print(f"Sessions directory not found: {SESSIONS_DIR}")
        sys.exit(1)

    jsonl_files = list(SESSIONS_DIR.glob("*.jsonl"))
    print(f"Found {len(jsonl_files)} session files in {SESSIONS_DIR}")

    for f in jsonl_files:
        inserted, skipped = ingest_session(db, f)
        print(f"  {f.name}: {inserted} inserted, {skipped} skipped")
        total_inserted += inserted
        total_skipped += skipped

    db.close()
    print(f"\nDone. {total_inserted} events ingested into {DB_PATH}")
    if total_skipped:
        print(f"  ({total_skipped} duplicates skipped)")


if __name__ == "__main__":
    main()
