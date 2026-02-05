# Multi-stage Dockerfile for Agent Runtime
#
# Stage 1 (builder): Compiles TypeScript to JavaScript with all dependencies
# Stage 2 (runtime): Runs compiled agent runtime with production dependencies only
#
# Build: docker build -t agent-runtime -f packages/agent-runtime/Dockerfile .
# Run:   docker run -e BASE_ADDRESS=g.connector.agent -e BUSINESS_LOGIC_URL=http://business:8080 -p 3100:3100 agent-runtime

# ============================================
# Stage 1: Builder
# ============================================
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy dependency manifests first (for layer caching)
# Root package files define the workspace structure
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./

# Copy workspace package.json files to preserve monorepo structure
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (including devDependencies for TypeScript compilation)
# Use npm ci for reproducible builds
# Use --ignore-scripts to skip prepare script (git hooks not needed in Docker builds)
RUN npm ci --workspaces --ignore-scripts

# Copy TypeScript configuration and source code
COPY packages/agent-runtime/tsconfig.json ./packages/agent-runtime/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/agent-runtime/src ./packages/agent-runtime/src
COPY packages/shared/src ./packages/shared/src

# Build all packages (TypeScript compilation)
# Build shared first, then agent-runtime (dependency order)
RUN npm run build --workspace=@m2m/shared && npm run build --workspace=@m2m/agent-runtime

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:22-alpine AS runtime

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy dependency manifests for production installation
COPY package.json package-lock.json ./
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/shared/package.json ./packages/shared/

# Install production dependencies only (excludes devDependencies like TypeScript)
# This significantly reduces image size
# Use --ignore-scripts to skip prepare script (husky is a devDependency, not needed in production)
RUN npm ci --workspaces --omit=dev --ignore-scripts

# Copy compiled JavaScript from builder stage
# Only copy dist directories, not source code
COPY --from=builder /app/packages/agent-runtime/dist ./packages/agent-runtime/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Install wget for health check (minimal package, available in Alpine)
# Used by Docker HEALTHCHECK to query HTTP health endpoint
RUN apk add --no-cache wget

# Security hardening: Run as non-root user
# Alpine's node image includes a 'node' user by default
RUN chown -R node:node /app

# Switch to non-root user (prevents privilege escalation attacks)
USER node

# Expose HTTP server port
# Default: 3100 (configurable via PORT environment variable)
EXPOSE 3100

# Health check: Query HTTP health endpoint
# Interval: Check every 30 seconds (balance between responsiveness and overhead)
# Timeout: Health endpoint must respond within 10 seconds
# Start period: Allow 10 seconds for agent runtime startup
# Retries: Mark unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Start agent runtime
# Environment variables:
# - PORT: HTTP server port (default: 3100)
# - BASE_ADDRESS: ILP address prefix (required)
# - BUSINESS_LOGIC_URL: URL to business logic handler (required)
# - BUSINESS_LOGIC_TIMEOUT: Request timeout in ms (default: 5000)
# - SPSP_ENABLED: Enable SPSP endpoint (default: true)
# - SESSION_TTL_MS: Session TTL in ms (default: 3600000)
# - LOG_LEVEL: Log level (default: info)
# - NODE_ID: Node ID for logging (default: agent-runtime)
CMD ["node", "packages/agent-runtime/dist/index.js"]
