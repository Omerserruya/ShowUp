# Dockerfile for cloudflared tunnel
FROM debian:stable-slim

WORKDIR /cloudflared

# Install curl and download cloudflared
RUN apt-get update && apt-get install -y curl && \
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && \
    chmod +x cloudflared

COPY config.yml /etc/cloudflared/config.yml

CMD ["./cloudflared", "tunnel", "--config", "/etc/cloudflared/config.yml", "run"]
