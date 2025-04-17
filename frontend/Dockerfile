# Frontend Dockerfile
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Output only the built files
# (Optional: You can skip this if we mount from /app/build directly)
