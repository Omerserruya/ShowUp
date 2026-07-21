FROM python:3.11-slim

WORKDIR /app

COPY otp-worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY otp-worker/ /app/
# Shared observability + ops helpers. Build context is the repo root.
COPY shared /app/shared

ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]

