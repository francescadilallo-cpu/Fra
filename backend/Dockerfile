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

# LLM intent mapping: when ANTHROPIC_API_KEY is set (in Render's env), the
# semantic layer uses Claude to understand any phrasing of a question. With
# this flag at 0 the behaviour is "use the LLM when available, otherwise fall
# back to the deterministic rule parser" — so a missing or failing key degrades
# gracefully to rules instead of returning 422 errors.
ENV SEMANTIC_REQUIRE_LLM_INTENT=0

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
