#!/usr/bin/env python3
"""Execute notebook commands on Azure Databricks cluster via REST API"""
import urllib.request, json, time, os, sys

URL = os.environ.get("DBURL", "")
TOKEN = os.environ.get("DBTOKEN", "")
CLUSTER = os.environ.get("DBCLUSTER", "")

if not all([URL, TOKEN, CLUSTER]):
    print("Set DBURL, DBTOKEN, DBCLUSTER env vars")
    sys.exit(1)

def api(endpoint, data=None, method="POST"):
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(
        f"{URL}{endpoint}", data=body,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"HTTP {e.code}: {body[:300]}")
        return {"error": body}

def create_context():
    """Create an execution context on the cluster"""
    r = api("/api/1.2/contexts/create", {"clusterId": CLUSTER, "language": "python"})
    if "error" in r:
        return None
    ctx_id = r.get("id")
    print(f"Context: {ctx_id}")
    return ctx_id

def run(ctx_id, code, lang="python"):
    """Execute code and wait for result"""
    r = api("/api/1.2/commands/execute", {
        "clusterId": CLUSTER, "contextId": ctx_id,
        "language": lang, "command": code})
    if "error" in r:
        return None
    cmd_id = r["id"]
    
    for i in range(120):
        time.sleep(5)
        s = get_status(cmd_id)
        state = s.get("status", "?")
        if state in ("Finished", "Error", "Cancelled"):
            res = s.get("results", {})
            if state == "Finished":
                data = res.get("data", "")
                print(f"  OK: {str(data)[:400]}")
            else:
                print(f"  ERR: {res.get('cause','')[:400]}")
            return s
        if i % 6 == 0:
            print(f"  waiting... ({(i+1)*5}s) state={state}")
    print("  TIMEOUT")
    return None

def get_status(cmd_id):
    """Get command status (GET request with query params)"""
    ep = f"/api/1.2/commands/status?clusterId={CLUSTER}&commandId={cmd_id}"
    req = urllib.request.Request(
        f"{URL}{ep}",
        headers={"Authorization": f"Bearer {TOKEN}"},
        method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"status": "Error", "results": {"cause": e.read().decode()[:200]}}

# ─── Main ───
print("=== Step 1: Create execution context ===")
ctx = create_context()
if not ctx:
    print("Failed to create context")
    sys.exit(1)

print("\n=== Step 2: Create schema ===")
run(ctx, "spark.sql('CREATE SCHEMA IF NOT EXISTS datacore'); print('Schema ready')")

print("\n=== Step 3: Read JSONL → Delta table ===")
run(ctx, '''
df = spark.read.format("json").option("multiLine", False).load("dbfs:/FileStore/datacore/bronze-all.jsonl")
cnt = df.count()
df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("datacore.default.bronze_events")
print(f"Written {cnt} events to datacore.default.bronze_events")
''')

print("\n=== Step 4: Enable Change Data Feed ===")
run(ctx, "spark.sql('ALTER TABLE datacore.default.bronze_events SET TBLPROPERTIES (delta.enableChangeDataFeed = true)'); print('CDF enabled')")

print("\n=== Step 5: Verify ===")
run(ctx, """
rows = spark.sql('SELECT source, count(*) as cnt FROM datacore.default.bronze_events GROUP BY source ORDER BY cnt DESC').collect()
for r in rows:
    print(f"  {r['source']:30s} {r['cnt']:6d}")
total = spark.sql('SELECT count(*) as n FROM datacore.default.bronze_events').collect()[0]['n']
print(f"  {'TOTAL':30s} {total:6d}")
""")

print("\n=== DONE: Bronze Delta table ready ===")
