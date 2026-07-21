FROM python:3.11-slim

WORKDIR /app

COPY planner-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY planner-service/ /app/
# Shared ops helpers (heartbeat/error capture). Build context is the repo root.
COPY shared /app/shared

EXPOSE ${PORT}
CMD ["python", "main.py"]
