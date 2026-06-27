FROM python:3.11-slim

WORKDIR /app

# Build context is the repo root (see docker-compose) so the shared kernel can be
# vendored, mirroring core-service / webhook-worker.
COPY campaign-worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY campaign-worker/ /app/
# Shared domain kernel (enums, audience values) — single source of truth.
COPY shared /app/shared

ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]
