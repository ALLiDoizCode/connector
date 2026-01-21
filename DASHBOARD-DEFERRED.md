# Dashboard Component - Deferred to Future Project

**Date:** January 21, 2026
**Decision:** Dashboard visualization removed from M2M project scope

## Rationale

The dashboard component (`packages/dashboard`) has been removed from the M2M project for the following reasons:

1. **Recurring CI/CD Issues**: The dashboard tests consistently failed in pre-push hooks due to Jest configuration conflicts
2. **Scope Creep**: The core M2M project is focused on Interledger Protocol (ILP) connector infrastructure and payment channels
3. **Separate Concerns**: Visualization is a distinct concern that should be developed as a separate project
4. **Maintenance Burden**: The React/TypeScript dashboard added significant complexity to the build pipeline

## What Was Removed

- **Package**: `packages/dashboard` (React + TypeScript + Vite + shadcn/ui)
- **Docker Services**: Dashboard containers from all docker-compose files
- **Tests**: Dashboard unit and integration tests
- **Dependencies**: React, Vite, Cytoscape, and related UI libraries
- **Documentation**: Dashboard-specific QA gates (moved to `docs/qa/gates/archived/dashboard/`)

## Core Functionality Preserved

The M2M project retains all essential connector functionality:

- ✅ **Connector Core**: Packet forwarding, routing, BTP protocol
- ✅ **Settlement**: TigerBeetle accounting, payment channels (EVM + XRP)
- ✅ **Agent Wallets**: HD wallet derivation, lifecycle management, channel integration
- ✅ **Blockchain Integration**: Anvil (Base L2) + rippled (XRP Ledger) local development
- ✅ **Telemetry**: Event emission system (telemetry server removed, but events still emitted)

## Telemetry System Status

The telemetry **emission** system remains intact in the connector:

- ✅ Connectors still emit telemetry events (packet forwarding, channel operations, settlements)
- ✅ `TelemetryEmitter` class operational in `packages/connector/src/telemetry/`
- ✅ All event types defined in `packages/shared/src/types/telemetry.ts`
- ❌ Dashboard WebSocket server removed (no visualization consumer)

## Future Dashboard Project

If visualization is needed in the future, consider:

1. **Separate Repository**: Build dashboard as standalone project that consumes telemetry
2. **Technology Options**:
   - React + Next.js for SSR/SSG
   - Grafana + Prometheus for metrics visualization
   - Custom WebSocket client connecting to connector telemetry endpoints
3. **API-First Design**: Define clear telemetry API contract between connector and dashboard
4. **Independent CI/CD**: Dashboard tests don't block connector development

## Migration Path (If Needed)

To restore dashboard functionality:

```bash
# Retrieve dashboard code from git history
git checkout <pre-removal-commit> -- packages/dashboard

# Or create new dashboard project
mkdir ilp-dashboard
cd ilp-dashboard
npm init
# Build fresh dashboard consuming M2M telemetry events
```

## Related Documentation

- **Architecture**: See `docs/architecture/` (updated to remove dashboard references)
- **Docker Compose**: See `docker-compose*.yml` (dashboard services removed)
- **Archived QA Gates**: See `docs/qa/gates/archived/dashboard/`

## Decision Authority

This decision was made to unblock development and focus on core M2M connector functionality. The dashboard can be revisited as a separate project when resources permit.

---

**Impact**: Dashboard removal eliminates ~15,000 lines of code and ~50 test files, simplifying the build pipeline and reducing CI/CD complexity.
