# Multi-stage build for dashboard (React UI + Node.js telemetry server)
# Stage 1: Build the React application and TypeScript server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files and workspace structure
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/shared/ packages/shared/

# Install all dependencies (including workspace dependencies)
RUN npm ci

# Copy dashboard source files and configuration
COPY packages/dashboard/ packages/dashboard/

# Build the React application
WORKDIR /app/packages/dashboard
RUN npm run build

# Build the TypeScript server
RUN npm run build:server

# Stage 2: Production runtime with Node.js
FROM node:20-alpine

WORKDIR /app

# Copy package.json for runtime dependencies
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/dashboard/package.json ./packages/dashboard/

# Install production dependencies only
RUN npm ci --workspace=packages/dashboard --omit=dev

# Copy built React files (static assets)
COPY --from=builder /app/packages/dashboard/dist ./packages/dashboard/dist

# Copy built server files
COPY --from=builder /app/packages/dashboard/dist/server ./packages/dashboard/dist/server

# Expose ports: 8080 for HTTP static files, 9000 for telemetry WebSocket
EXPOSE 8080 9000

# Set environment variables
ENV TELEMETRY_WS_PORT=9000
ENV LOG_LEVEL=info
ENV NODE_ENV=production

WORKDIR /app/packages/dashboard

# Start the dashboard backend (telemetry server)
CMD ["node", "dist/server/index.js"]
