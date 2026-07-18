FROM python:3.11-slim

WORKDIR /app

# Build context is the repo root (see docker-compose) so the shared kernel can be
# vendored, mirroring core-service / campaign-worker / webhook-worker.
COPY scheduler-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY scheduler-service/ /app/
# Shared domain kernel (system notification templates SSOT).
COPY shared /app/shared

ENV PYTHONUNBUFFERED=1

EXPOSE ${PORT}
CMD ["python", "scheduler.py"]
