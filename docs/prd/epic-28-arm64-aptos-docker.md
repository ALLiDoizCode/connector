# Epic 28: ARM64 Aptos Docker Image for Local Development

## Epic Metadata

| Field                | Value                                             |
| -------------------- | ------------------------------------------------- |
| **Epic ID**          | 28                                                |
| **Title**            | ARM64 Aptos Docker Image for Local Development    |
| **Status**           | Draft                                             |
| **Priority**         | High (unblocks Aptos testing on Apple Silicon)    |
| **Depends On**       | None (infrastructure epic)                        |
| **Enables**          | Epic 27 (Aptos Payment Channels) testing on ARM64 |
| **Estimated Points** | 15                                                |

---

## Problem Statement

The official `aptoslabs/tools` Docker image only provides `linux/amd64` builds. This prevents developers on Apple Silicon (M1/M2/M3/M4) Macs from running the Aptos local testnet in Docker, blocking the docker-agent-test suite's Aptos integration on ARM64 systems.

Currently, the test script auto-disables Aptos on ARM64 with the message:

> "Note: Aptos disabled on aarch64 (only amd64 is supported)"

This means Epic 27's Aptos payment channel integration cannot be tested on the majority of modern Mac development machines without either:

- Running tests on a remote x86_64 machine
- Using slow QEMU emulation
- Installing Aptos CLI natively (bypassing Docker infrastructure)

---

## Proposed Solution

Build and publish a multi-architecture Docker image containing the Aptos node and CLI tools, supporting both `linux/amd64` and `linux/arm64` platforms. The image will be:

1. **Built from source** - Compile aptos-core for ARM64 architecture
2. **Published to Docker Hub** - Available at `m2mproject/aptos-tools` (or similar org account)
3. **CI/CD automated** - GitHub Actions builds and pushes on main branch merge
4. **Integrated into tests** - docker-compose-agent-test.yml updated to use new image

---

## Success Criteria

| #   | Criterion                                                                      | Verification                                           |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | Docker image runs `aptos node run-local-testnet` successfully on Apple Silicon | Manual test on M1/M2/M3 Mac                            |
| 2   | Image published to Docker Hub with multi-arch manifest                         | `docker manifest inspect` shows both platforms         |
| 3   | CI/CD pipeline builds and pushes on main branch merge                          | GitHub Actions workflow succeeds                       |
| 4   | docker-compose-agent-test.yml uses new image                                   | Config review, no `platform: linux/amd64` override     |
| 5   | Agent test passes with Aptos enabled on ARM64                                  | `./scripts/run-docker-agent-test.sh` passes with Aptos |

---

## Stories

| Story | Title                            | Description                                                                                            | Points |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 28.1  | Create ARM64 Aptos Dockerfile    | Multi-stage Dockerfile building Aptos from source for ARM64, optimized for size                        | 5      |
| 28.2  | Configure Docker Hub Repository  | Set up m2mproject/aptos-tools repo on Docker Hub with org credentials and access tokens                | 2      |
| 28.3  | Create GitHub Actions Workflow   | CI/CD pipeline using docker/build-push-action with QEMU for multi-arch builds, triggered on main merge | 3      |
| 28.4  | Update Agent Test Infrastructure | Modify docker-compose-agent-test.yml and run script to use new image, remove ARM64 skip logic          | 2      |
| 28.5  | Verify ARM64 Aptos Integration   | End-to-end test of Aptos payment channels on Apple Silicon, document any issues                        | 3      |

**Total Points:** 15

---

## Technical Approach

### Dockerfile Strategy

```dockerfile
# ============================================
# Stage 1: Build Aptos from source
# ============================================
FROM rust:1.75-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    cmake \
    clang \
    lld \
    libssl-dev \
    pkg-config \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Clone aptos-core at specific tag/commit
ARG APTOS_VERSION=main
RUN git clone --depth 1 --branch ${APTOS_VERSION} \
    https://github.com/aptos-labs/aptos-core.git /aptos

WORKDIR /aptos

# Build only necessary binaries
RUN cargo build --release -p aptos -p aptos-node

# ============================================
# Stage 2: Minimal runtime image
# ============================================
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy binaries from builder
COPY --from=builder /aptos/target/release/aptos /usr/local/bin/
COPY --from=builder /aptos/target/release/aptos-node /usr/local/bin/

# Verify installation
RUN aptos --version

ENTRYPOINT ["/usr/local/bin/aptos"]
```

### CI/CD Pipeline (GitHub Actions)

```yaml
name: Build Aptos Docker Image

on:
  push:
    branches: [main]
    paths:
      - 'docker/aptos/**'
      - '.github/workflows/build-aptos-image.yml'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: docker/aptos
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            m2mproject/aptos-tools:latest
            m2mproject/aptos-tools:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Integration Changes

```yaml
# docker-compose-agent-test.yml - BEFORE
aptos-local:
  image: aptoslabs/tools:${APTOS_IMAGE_TAG:-nightly}
  platform: linux/amd64  # Forces emulation on ARM64
  profiles:
    - aptos

# docker-compose-agent-test.yml - AFTER
aptos-local:
  image: m2mproject/aptos-tools:${APTOS_IMAGE_TAG:-latest}
  # No platform override - multi-arch image works natively
```

```bash
# scripts/run-docker-agent-test.sh - REMOVE this logic
ARCH=$(docker info --format '{{.Architecture}}')
if [ "$APTOS_ENABLED" = "auto" ]; then
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
        APTOS_ENABLED="true"
    else
        echo "Note: Aptos disabled on $ARCH (only amd64 is supported)"
        APTOS_ENABLED="false"
    fi
fi
```

---

## Risks & Mitigations

| Risk                                           | Likelihood | Impact | Mitigation                                             |
| ---------------------------------------------- | ---------- | ------ | ------------------------------------------------------ |
| ARM64 build fails due to Rust/LLVM issues      | Medium     | High   | Test local build on M1 Mac before CI; pin Rust version |
| Build time exceeds GitHub Actions limits (6hr) | Medium     | Medium | Use build caching, consider self-hosted runner         |
| Docker Hub rate limits on pulls                | Low        | Low    | Use authenticated pulls; consider GHCR as backup       |
| Aptos source changes break build               | Low        | Medium | Pin to release tags, not `main` branch                 |
| Large image size (>2GB)                        | Medium     | Low    | Multi-stage build, strip debug symbols                 |

---

## Out of Scope

- Building Aptos Indexer API (not needed for local testnet)
- Supporting other architectures (e.g., RISC-V, Windows containers)
- Upstream contribution to aptos-labs/aptos-core (they may add ARM64 eventually)
- Mainnet/testnet node operation (local testnet only)

---

## Dependencies

### External

- Docker Hub organization account with push access
- GitHub Actions secrets for Docker Hub credentials

### Internal

- Epic 27 provides the Aptos payment channel code to test
- Existing docker-compose-agent-test.yml infrastructure

---

## Acceptance Criteria

1. **AC1**: Running `docker run --rm m2mproject/aptos-tools:latest --version` succeeds on both x86_64 and ARM64 hosts
2. **AC2**: Running `docker run --rm m2mproject/aptos-tools:latest node run-local-testnet --force-restart --assume-yes` starts a functional local testnet on ARM64
3. **AC3**: `./scripts/run-docker-agent-test.sh` completes with Aptos enabled on Apple Silicon Mac
4. **AC4**: GitHub Actions workflow completes in under 2 hours (with caching)
5. **AC5**: Final image size is under 500MB

---

## References

- [Aptos Core Repository](https://github.com/aptos-labs/aptos-core)
- [Docker Buildx Multi-Platform Builds](https://docs.docker.com/build/building/multi-platform/)
- [GitHub Actions: docker/build-push-action](https://github.com/docker/build-push-action)
- Epic 27: Aptos Payment Channels (Move Modules)
