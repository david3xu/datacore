# Datacore — Schema Design

## The Common Event

Every piece of data from any source becomes one or more **events**.
An event is the atomic unit — something happened, at a time, from a source.

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,     -- uuid
  timestamp     TEXT NOT NULL,        -- ISO 8601
  source        TEXT NOT NULL,        -- 'openclaw' | 'claude' | 'git' | 'linkedin' | 'devto' | 'discord'
  source_id     TEXT,                 -- original ID from the source platform
  session_id    TEXT,                 -- groups events into a conversation/session
  parent_id     TEXT,                 -- reply-to / caused-by (conversation tree)
  actor         TEXT NOT NULL,        -- 'david' | 'ai:gpt-5-mini' | 'ai:claude-opus' | 'system'
  event_type    TEXT NOT NULL,        -- 'message' | 'tool_call' | 'tool_result' | 'commit' | 'post' | 'article'
  content_text  TEXT,                 -- plain text content (searchable)
  content_json  TEXT,                 -- full structured content as JSON (preserves source detail)
  metadata      TEXT                  -- source-specific extras as JSON
);

CREATE INDEX idx_timestamp ON events(timestamp);
CREATE INDEX idx_source ON events(source);
CREATE INDEX idx_session ON events(session_id);
CREATE INDEX idx_actor ON events(actor);
CREATE INDEX idx_type ON events(event_type);
```

## Source Mapping

### OpenClaw Sessions → Events

```
JSONL event type       →  event_type      actor
─────────────────────────────────────────────────
message (role=user)    →  'message'       'david'
message (role=asst)    →  'message'       'ai:{provider}/{model}'
message (toolResult)   →  'tool_result'   'system'
model_change           →  'config'        'system'
session                →  'session_start' 'system'

session_id  = JSONL filename (uuid)
source_id   = event.id from JSONL
parent_id   = event.parentId from JSONL
content_text = extracted text from message.content[]
content_json = full message object
metadata    = {channel, provider, model, thinkingLevel}
```

### Git Commits → Events

```
event_type  = 'commit'
actor       = 'david' (or commit author)
source_id   = commit hash
content_text = commit message
metadata    = {repo, branch, files_changed, insertions, deletions}
```

### LinkedIn Posts → Events

```
event_type  = 'post'
actor       = 'david'
source_id   = post URN
content_text = post text
metadata    = {media_type, impressions, reactions}
```

### DEV.to Articles → Events

```
event_type  = 'article'
actor       = 'david'
source_id   = article ID
content_text = title + body excerpt
metadata    = {url, tags, published_at}
```

## What This Enables

Once everything is in one table:

```sql
-- What did I do last Tuesday?
SELECT * FROM events 
WHERE timestamp BETWEEN '2026-03-18T00:00:00' AND '2026-03-19T00:00:00'
ORDER BY timestamp;

-- All AI conversations this week
SELECT * FROM events 
WHERE event_type = 'message' AND actor LIKE 'ai:%'
AND timestamp > '2026-03-17';

-- Thread from bug to fix to article
SELECT * FROM events 
WHERE session_id = '...' OR source_id IN (...)
ORDER BY timestamp;

-- Which model did I use most?
SELECT actor, COUNT(*) FROM events 
WHERE actor LIKE 'ai:%' GROUP BY actor ORDER BY 2 DESC;
```
