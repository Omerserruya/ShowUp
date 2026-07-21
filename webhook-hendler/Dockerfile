FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching (build context is the repo root)
COPY webhook-hendler/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY webhook-hendler/ .
# Shared ops helpers (heartbeat/error capture).
COPY shared ./shared

# Expose port
EXPOSE ${PORT}

# Run the application
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]

