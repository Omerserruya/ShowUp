# Nginx Configuration

## Overview

This directory contains the Nginx configuration files for the Aurora.io project. Nginx serves as a reverse proxy and API gateway, routing requests to the appropriate microservices and serving static files.

## Configuration Files

- `nginx.conf`: Main Nginx configuration file
- `conf.d/default.conf`: Application-specific configuration for routing and security
- `conf.d/terraform.conf`: Configuration for proxying requests to the Terraform service

## Features

- Reverse proxy for routing to microservices
- Static file serving for frontend and uploads
- API Gateway pattern for microservices communication
- Security features for protecting sensitive endpoints
- CORS configuration
- Handling of HTTP OPTIONS requests
- Security headers

## Terraform Service Proxy

The Nginx configuration includes a proxy setup for the Terraform service:

- Base URL: `http://localhost/api/iac/`
- Proxies to: `http://localhost:7810/`
- Health check: `http://localhost/api/health`

### Example Requests

```bash
# Health check
curl http://localhost/api/health

# Generate Terraform
curl "http://localhost/api/iac/generate_tf?user_id=123&account_id=456"

# Get Terraform info
curl http://localhost/api/iac/terraform
```

## Routing Configuration

The Nginx configuration routes traffic as follows:

1. **Frontend (Static Files)**:
   - Route: `/`
   - Target: Serves static React build files from `/usr/share/nginx/html`

2. **Users Service**:
   - Route: `/api/users/`
   - Target: `users-service:4001`
   - Special handling for `/api/users/add` to block unauthorized POST requests

3. **Auth Service**:
   - Route: `/api/auth/`
   - Target: `auth-service:4002`

4. **Static Files**:
   - Route: `/api/uploads/users/`
   - Target: Serves files from `/app/uploads/users/`
   - Route: `/api/uploads/posts/`
   - Target: Serves files from `/app/uploads/posts/`

## Security Features

### Access Control for `/api/users/add`

To protect the user creation endpoint from unauthorized external access, Nginx uses a combination of maps and conditions:

```nginx
# Trust specific referers
geo $http_referer $referer_trusted {
    default                     0;
    "localhost"                 1;
    "127.0.0.1"                 1;
}

# Create a map for blocking POST requests to /api/users/add
map $request_method:$referer_trusted:$http_x_internal_service $block_add_user {
    # Allow if not POST
    "~:~:~"                0;
    # Allow POST with trusted referer
    "POST:1:~"             0;
    # Allow POST with internal service header
    "POST:~:true"          0;
    # Block all other POST requests
    "POST:0:~"             1;
    default                0;
}
```

This configuration:
1. Allows non-POST requests to pass through
2. Allows POST requests from trusted referers (localhost, 127.0.0.1)
3. Allows POST requests with the `X-Internal-Service: true` header
4. Blocks all other POST requests to `/api/users/add`

### CORS Configuration

CORS headers are configured for all endpoints to allow controlled cross-origin access:

```nginx
add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,X-Internal-Service' always;
add_header 'Access-Control-Allow-Credentials' 'true' always;
```

## Docker Usage

The Nginx configuration is mounted into the Nginx container using volumes in Docker Compose:

```yaml
nginx:
  image: nginx:alpine
  ports:
    - "80:80"  # HTTP port for local development
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./nginx/conf.d:/etc/nginx/conf.d:ro
    - ./userMgmntService/uploads:/app/uploads:ro
    - frontend-build:/usr/share/nginx/html:ro  # Serve React build files
```

## Local Development

For local development, the configuration uses:
- HTTP on port 80 (no HTTPS)
- Trusted referers set to localhost and 127.0.0.1
- CORS headers that allow requests from any origin (`*`)

## Production Configuration

For production, the following changes would be required:
- Add HTTPS configuration with SSL certificates
- Restrict CORS to specific domains
- Update trusted referers to include the production domain
- Configure SSL redirects

## Setup Instructions

1. Make sure the Terraform service is running on port 7810
2. Ensure Nginx is installed and running
3. Copy the configuration files to the appropriate locations:
   ```bash
   sudo cp nginx.conf /etc/nginx/nginx.conf
   sudo cp conf.d/* /etc/nginx/conf.d/
   ```
4. Test the configuration:
   ```bash
   sudo nginx -t
   ```
5. Reload Nginx:
   ```bash
   sudo nginx -s reload
   ``` 