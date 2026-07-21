FROM python:3.11-slim

WORKDIR /app

COPY contact-import-worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY contact-import-worker/ /app/
# Shared ops helpers (heartbeat/error capture). Build context is the repo root.
COPY shared /app/shared

ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]

