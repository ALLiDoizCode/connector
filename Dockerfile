# Multi-stage Dockerfile for ILP Connector
#
# Stage 1 (builder): Compiles TypeScript to JavaScript with all dependencies
# Stage 2 (runtime): Runs compiled connector with production dependencies only
#
# Build: docker build -t ilp-connector .
# Run:   docker run -e NODE_ID=connector-a -e BTP_SERVER_PORT=3000 -p 3000:3000 ilp-connector

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy dependency manifests first (for layer caching)
# Root package files define the workspace structure
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy workspace package.json files to preserve monorepo structure
COPY packages/connector/package.json ./packages/connector/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (including devDependencies for TypeScript compilation)
# Use npm ci for reproducible builds
RUN npm ci --workspaces

# Copy TypeScript configuration and source code
COPY packages/connector/tsconfig.json ./packages/connector/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/connector/src ./packages/connector/src
COPY packages/shared/src ./packages/shared/src

# Build all packages (TypeScript compilation)
# Build shared first, then connector (dependency order)
RUN npm run build --workspace=@m2m/shared && npm run build --workspace=@m2m/connector

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:20-alpine AS runtime

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy dependency manifests for production installation
COPY package.json package-lock.json ./
COPY packages/connector/package.json ./packages/connector/
COPY packages/shared/package.json ./packages/shared/

# Install production dependencies only (excludes devDependencies like TypeScript)
# This significantly reduces image size
RUN npm ci --workspaces --omit=dev

# Copy compiled JavaScript from builder stage
# Only copy dist directories, not source code
COPY --from=builder /app/packages/connector/dist ./packages/connector/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Install wget for health check (minimal package, available in Alpine)
# Used by Docker HEALTHCHECK to query HTTP health endpoint
RUN apk add --no-cache wget

# Security hardening: Run as non-root user
# Alpine's node image includes a 'node' user by default
# Change ownership of application files to node user
RUN chown -R node:node /app

# Switch to non-root user (prevents privilege escalation attacks)
USER node

# Expose BTP server port (WebSocket)
# Default: 3000 (configurable via BTP_SERVER_PORT environment variable)
EXPOSE 3000

# Expose health check HTTP port
# Default: 8080 (configurable via HEALTH_CHECK_PORT environment variable)
EXPOSE 8080

# Health check: Query HTTP health endpoint
# Interval: Check every 30 seconds (balance between responsiveness and overhead)
# Timeout: Health endpoint must respond within 10 seconds
# Start period: Allow 40 seconds for connector startup (BTP connections establishment)
# Retries: Mark unhealthy after 3 consecutive failures
#
# The health endpoint returns:
# - 200 OK when connector is healthy (≥50% peers connected)
# - 503 Service Unavailable when unhealthy or starting
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start connector
# Environment variables:
# - NODE_ID: Connector identifier (default: 'connector-node')
# - BTP_SERVER_PORT: BTP server listening port (default: 3000)
# - LOG_LEVEL: Pino log level (default: 'info', options: debug|info|warn|error)
CMD ["node", "packages/connector/dist/index.js"]
