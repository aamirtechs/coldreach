#!/usr/bin/env python3
"""Run a Calling ops script (probe or seed) against the production
Neon database, following the run-list.py pattern: the connection
string is fetched in memory through the custom.neon helper, passed
only as an environment variable to the child process, and redacted
from all output. Usage: run-seed-calling.py <script.ts> [--apply]
"""
import os, subprocess, sys, urllib.parse
sys.path.insert(0, os.path.expanduser("~/workspace/custom-connectors/custom.neon/bin"))
import neon_api

PROJECT = "cold-dew-49612719"
script = sys.argv[1]
extra = sys.argv[2:]

raw = neon_api.fetch_connection_string(PROJECT)
conn = neon_api.prisma_friendly(raw)
parsed = urllib.parse.urlparse(conn)
print(f"Fetched pooled connection string in memory for host {parsed.hostname} (database {parsed.path.lstrip('/')}). String never printed.")

env = dict(os.environ)
env["DATABASE_URL"] = conn
env["DIRECT_URL"] = conn
engines = os.path.expanduser("~/workspace/coldreach/node_modules/@prisma/engines")
env["PRISMA_QUERY_ENGINE_LIBRARY"] = os.path.join(engines, "libquery_engine-debian-openssl-3.0.x.so.node")
env["PRISMA_SCHEMA_ENGINE_BINARY"] = os.path.join(engines, "schema-engine-debian-openssl-3.0.x")
env["PRISMA_ENGINES_CHECK_IGNORE"] = "1"
env["CHECKPOINT_DISABLE"] = "1"
cwd = os.path.expanduser("~/workspace/coldreach")

def run(cmd, use_env):
    r = subprocess.run(cmd, cwd=cwd, env=use_env, capture_output=True, text=True, timeout=900)
    out = neon_api.redact((r.stdout or "") + (r.stderr or ""), conn)
    out = neon_api.redact(out, raw)
    print(f"$ {' '.join(cmd)} -> exit {r.returncode}")
    print(out)
    return r.returncode

code = run(["npx", "prisma", "generate", "--schema", "prisma/prod/schema.prisma"], env)
if code == 0:
    code = run(["npx", "tsx", script] + extra, env)
dev_env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "DIRECT_URL")}
dev_env["PRISMA_QUERY_ENGINE_LIBRARY"] = env["PRISMA_QUERY_ENGINE_LIBRARY"]
dev_env["PRISMA_SCHEMA_ENGINE_BINARY"] = env["PRISMA_SCHEMA_ENGINE_BINARY"]
dev_env["PRISMA_ENGINES_CHECK_IGNORE"] = "1"
dev_env["CHECKPOINT_DISABLE"] = "1"
r = subprocess.run(["npx", "prisma", "generate"], cwd=cwd, env=dev_env, capture_output=True, text=True, timeout=600)
print(f"Dev Prisma client regenerated (exit {r.returncode}).")
sys.exit(code)
