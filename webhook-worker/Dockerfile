FROM python:3.11-slim

WORKDIR /app

# Build context is the repo root (see docker-compose) so the shared kernel can be
# vendored, mirroring core-service. Copy requirements first for layer caching.
COPY webhook-worker/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY webhook-worker/ /app/
# Shared domain kernel (enums, rsvp resolver, roles) - single source of truth.
COPY shared /app/shared

# Run the worker
CMD ["python", "worker.py"]
