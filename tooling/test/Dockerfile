# Test/migration runner image for core-service.
# Installs the service's own requirements plus test + migration tooling.
# Source is mounted at runtime (-v "$PWD":/work), not copied, so edits are picked up.
FROM python:3.12-slim

WORKDIR /work

# Build deps for psycopg2-binary are not needed (binary wheel), keep slim.
COPY core-service/requirements.txt /tmp/core-req.txt
RUN pip install --no-cache-dir -r /tmp/core-req.txt \
    && pip install --no-cache-dir pytest==8.3.3 alembic==1.13.2

# `app` (core-service/app) and `shared` (repo-root/shared) resolve as namespace packages.
ENV PYTHONPATH=/work/core-service:/work
ENV PYTHONDONTWRITEBYTECODE=1
