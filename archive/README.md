# Datacore Archive

> Files moved here are **superseded** by the MCP-based Bronze store and file watchers.
> They are preserved for historical reference only. Do not use them in production.
> Archived: March 23, 2026

## What's here

| File | Original purpose | Superseded by |
|---|---|---|
| `log-session.sh` | Manual session logging to sample-data/ | MCP `log_event` tool |
| `collect.sh` | Gather local files into sample-data/ for upload | File watchers (R6, R7, R9) |
| `upload.sh` | Push sample-data/ to ADLS Gen2 | Phase 2 pipeline (not yet built) |
| `sync-transcripts.sh` | Copy Claude transcripts to Mac | claude-agent-session-watcher (R7) |
| `query.py` | Query datacore SQLite database | MCP `search` tool |
| `datacore.db` | Pre-MCP SQLite event store | `~/.datacore/bronze/*.jsonl` |
| `RESEARCH.md` | Industry research notes (March 20) | Living docs in `docs/` |
| `RESEARCH-QUESTIONS.md` | Questions for OpenClaw re: Azure/Databricks | Answered and applied |
| `DIGEST.md` | Azure docs verification digest | Applied to DESIGN.md |
| `ingest/openclaw.py` | SQLite ingest for OpenClaw sessions | OpenClaw auto-log hook |
