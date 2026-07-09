FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p data

# Use the committed read-only DuckDB snapshot instead of rebuilding the
# in-memory database from the 14MB source dump on every query. Rebuilding
# in-memory exhausts Render's 512MB free-tier RAM and crashes the worker
# (surfaced as "Network Error" in the browser).
ENV FRA_STORAGE_MODE=snapshot

# LLM intent mapping: when ANTHROPIC_API_KEY (default) or GROQ_API_KEY (fallback)
# is set in Render's env, the semantic layer uses an LLM to understand any
# phrasing of a question. With this flag at 0 the behaviour is "use the LLM when
# available, otherwise fall back to the deterministic rule parser" — so a
# missing or failing key degrades gracefully to rules instead of 422 errors.
ENV SEMANTIC_REQUIRE_LLM_INTENT=0

# Auth session length. The default of 30 minutes forced a re-login mid-session;
# 7 days (10080 min) keeps users signed in across normal usage. Override via
# Render's env if a shorter/longer session is required.
ENV JWT_ACCESS_TOKEN_EXPIRE_MINUTES=10080

# ── Memory limits for Render free tier (512 MB RAM) ───────────────────────────
#
# The networkx KG can reach 150k+ nodes at default limits (~400 MB alone).
# These caps keep the in-process KG well within budget:
#   FRA_KG_NODE_LIMIT=5000  →  ~10-15 MB for the KG node store
#   FRA_KG_EDGE_LIMIT=5000  →  ~5-10 MB for the KG edge store
# Raise or set to 0 (unlimited) on a plan with ≥ 2 GB RAM.
ENV FRA_KG_NODE_LIMIT=5000
ENV FRA_KG_EDGE_LIMIT=5000

# Defer the background KG build to the first query instead of running it
# immediately at startup. This avoids exhausting RAM during the boot phase
# when Render's health-check is already consuming the process before queries
# start. On a warmer plan set to "false" to pre-build on boot.
ENV FRA_SKIP_WARMUP=true

# Salesforce: describe all queryable SObjects (no cap). 0 = unlimited.
ENV FRA_SF_MAX_OBJECTS=0

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
