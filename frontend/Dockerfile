# Frontend production build (static files).
#
# CRA inlines REACT_APP_* at BUILD time, so every value the bundle needs must
# be passed as a build arg - setting them as runtime env on a container does
# nothing. Example (from the repo root, values read from .env):
#
#   docker build -f frontend/Dockerfile --target export --output type=local,dest=frontend/build \
#     --build-arg REACT_APP_SENTRY_DSN="$REACT_APP_SENTRY_DSN" \
#     --build-arg REACT_APP_SENTRY_ENVIRONMENT=production \
#     --build-arg REACT_APP_SENTRY_RELEASE="$(git rev-parse --short HEAD)" \
#     --build-arg REACT_APP_GIT_SHA="$(git rev-parse --short HEAD)" \
#     --build-arg REACT_APP_GOOGLE_PLACES_API_KEY="$REACT_APP_GOOGLE_PLACES_API_KEY" \
#     --build-arg REACT_APP_WHATSAPP_NUMBER="$REACT_APP_WHATSAPP_NUMBER" \
#     --build-arg REACT_APP_TAX_RATE="${REACT_APP_TAX_RATE:-0.18}" \
#     frontend
#
# nginx (NGINX_MODE=static) serves ./frontend/build. Note: a CRA build needs
# ~1.5GB RAM; on the 3GB host stop frontend-dev first (or build elsewhere).
FROM node:18-alpine AS build

WORKDIR /app

# Same-origin API: nginx routes /api/* to the backends.
ARG REACT_APP_API_URL=/api
ARG REACT_APP_SENTRY_DSN=
ARG REACT_APP_SENTRY_ENVIRONMENT=production
ARG REACT_APP_SENTRY_RELEASE=
ARG REACT_APP_GIT_SHA=
ARG REACT_APP_GOOGLE_PLACES_API_KEY=
ARG REACT_APP_WHATSAPP_NUMBER=
ARG REACT_APP_TAX_RATE=0.18

# GENERATE_SOURCEMAP=false: no source maps in the public bundle (review 5.1).
ENV REACT_APP_API_URL=$REACT_APP_API_URL \
    REACT_APP_SENTRY_DSN=$REACT_APP_SENTRY_DSN \
    REACT_APP_SENTRY_ENVIRONMENT=$REACT_APP_SENTRY_ENVIRONMENT \
    REACT_APP_SENTRY_RELEASE=$REACT_APP_SENTRY_RELEASE \
    REACT_APP_GIT_SHA=$REACT_APP_GIT_SHA \
    REACT_APP_GOOGLE_PLACES_API_KEY=$REACT_APP_GOOGLE_PLACES_API_KEY \
    REACT_APP_WHATSAPP_NUMBER=$REACT_APP_WHATSAPP_NUMBER \
    REACT_APP_TAX_RATE=$REACT_APP_TAX_RATE \
    GENERATE_SOURCEMAP=false \
    CI=false \
    NODE_OPTIONS=--max-old-space-size=1536

COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
RUN npm run build

# `--target export --output type=local,dest=frontend/build` writes just the
# built files to the host.
FROM scratch AS export
COPY --from=build /app/build /
