# Business Logic Server Dockerfile
#
# Multi-stage build for TypeScript business logic server.
#
# Build: docker build -t my-business-logic .
# Run:   docker run -p 8080:8080 my-business-logic

# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Security: Run as non-root
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/server.js"]
