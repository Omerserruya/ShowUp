# Development Environment Setup

This guide explains how to run the development environment with hot reload.

## Prerequisites

- Docker and Docker Compose installed
- Environment variables configured in `.env` file

## Running Development Environment

### Start all services with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

This will:
- Start all backend services (same as production)
- Start frontend dev server with hot reload on port 3000
- Configure nginx to proxy frontend requests to the dev server
- Enable WebSocket support for hot reload

### Access the application:

- Frontend (with hot reload): http://localhost:${HTTP_PORT}
- Frontend dev server (direct): http://localhost:3000
- Backend services: Same ports as production

## Hot Reload Features

- **Automatic reload**: Changes to frontend files will automatically reload the browser
- **WebSocket support**: Configured for React dev server's hot reload
- **Volume mounting**: Frontend code is mounted as volume for instant changes

## Differences from Production

1. **Frontend**: Runs as dev server instead of static build
2. **Nginx config**: Uses `dev.conf` instead of `default.conf`
3. **Hot reload**: Enabled via WebSocket connections
4. **Volume mounts**: Frontend code is mounted for live editing

## Stopping Services

```bash
docker-compose -f docker-compose.dev.yml down
```

## Troubleshooting

### Hot reload not working:
- Check that WebSocket connections are allowed
- Verify that `CHOKIDAR_USEPOLLING=true` is set in frontend-dev service
- Check browser console for WebSocket connection errors

### Port conflicts:
- Make sure port 3000 is not in use by another service
- Check that ${HTTP_PORT} is available

### Changes not reflecting:
- Ensure volumes are properly mounted
- Check Docker logs: `docker-compose -f docker-compose.dev.yml logs frontend-dev`

