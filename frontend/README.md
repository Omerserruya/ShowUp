# Frontend

## Overview

This directory contains the frontend React application for Aurora.io. The frontend provides a modern user interface for interacting with the Aurora.io services, including user authentication, profile management, and other features.

## Technologies

- React.js
- React Router for navigation
- Axios for API requests
- Bootstrap or Material UI for styling (based on your implementation)
- Context API for state management
- Docker for containerization

## Features

- User registration and login
- OAuth login with Google and GitHub
- User profile management
- Avatar upload functionality
- Responsive design
- Protected routes for authenticated users
- Role-based access control

## Architecture

The frontend follows a modern React application architecture:
- Component-based UI structure
- React hooks for state management
- Context API for global state
- Axios for API communication
- React Router for client-side routing

### Communication with Backend Services

The frontend communicates with backend services through:
- Nginx API Gateway at `/api/*` endpoints
- Direct access to service endpoints during development

## Setup and Configuration

### Environment Variables

The frontend uses the following environment variables:

```
REACT_APP_API_URL=http://localhost
NODE_ENV=development
```

In production:
```
REACT_APP_API_URL=https://your-production-domain.com
NODE_ENV=production
```

## Running the Application

### With Docker Compose
The frontend is designed to run as part of the full Aurora.io application using Docker Compose:

```bash
# From the project root
docker compose build
docker compose up
```

### Standalone for Development
```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

## Available Scripts

- `npm start`: Runs the app in development mode
- `npm test`: Launches the test runner
- `npm run build`: Builds the app for production
- `npm run eject`: Ejects from Create React App (not recommended)

## File Structure

```
frontend/
├── public/                # Static files
│   ├── index.html        # HTML template
│   └── favicon.ico       # Favicon
├── src/                  # Source files
│   ├── components/       # React components
│   ├── contexts/         # Context providers
│   ├── hooks/            # Custom React hooks
│   ├── pages/            # Page components
│   ├── services/         # API services
│   ├── utils/            # Utility functions
│   ├── App.js            # Main App component
│   └── index.js          # Entry point
├── .env                  # Environment variables
├── Dockerfile            # Docker configuration
└── package.json          # NPM dependencies and scripts
```

## Key Components

### Authentication

The frontend handles authentication by:
- Storing JWT tokens in HTTP-only cookies
- Checking authentication status on protected routes
- Refreshing tokens automatically when needed
- Redirecting to login when authentication fails

### API Integration

API requests are centralized in service files:
- `authService.js`: Authentication-related API calls
- `userService.js`: User-related API calls

Example API call:
```javascript
// Example from authService.js
export const login = async (email, password) => {
  try {
    const response = await axios.post('/api/auth/login', { email, password });
    return response.data;
  } catch (error) {
    throw error;
  }
};
```

## Routing

Protected routes are implemented using React Router:

```jsx
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />
  
  {/* Protected routes */}
  <Route element={<ProtectedRoute />}>
    <Route path="/profile" element={<Profile />} />
    <Route path="/settings" element={<Settings />} />
  </Route>
</Routes>
```

## Docker Configuration

The frontend is containerized using the following Dockerfile:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

In Docker Compose, the frontend service is configured with:
- Volume mounts for code and node_modules
- Environment variables
- A shared volume for the build output with Nginx
