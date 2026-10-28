FROM python:3.11-slim

WORKDIR /app

# Build context is the repo root.
COPY voice-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY voice-service/ .
COPY shared ./shared

RUN mkdir -p /data/clips
EXPOSE 8090

# ONE worker process: the dialer thread lives in the app process, and two
# processes would just compete for the same rows (safe, but pointless).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8090} --workers 1 --no-access-log"]
