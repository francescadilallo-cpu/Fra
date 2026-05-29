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

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
