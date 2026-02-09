# ElizaOS Plugin Build & Publishing

## Table of Contents

1. [package.json Template](#packagejson-template)
2. [tsconfig.json Template](#tsconfigjson-template)
3. [tsup.config.ts Template](#tsupconfigts-template)
4. [Publishing Checklist](#publishing-checklist)
5. [CLI Commands](#cli-commands)

---

## package.json Template

```json
{
  "name": "@myorg/plugin-custom",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@elizaos/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsup": "^8.0.0",
    "@types/node": "^20.0.0"
  }
}
```

Notes:
- `"type": "module"` is required (ESM)
- `@elizaos/core` as dependency (externalized at build time)
- Add zod if using config validation: `"zod": "^3.0.0"`

## tsconfig.json Template

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## tsup.config.ts Template

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@elizaos/core'],
});
```

Critical: `external: ['@elizaos/core']` prevents bundling the core framework.

## Publishing Checklist

| Requirement | Details |
|------------|---------|
| Package name | Must start with `plugin-` |
| Description | Custom (not placeholder) |
| Logo image | `images/logo.jpg`, 400x400px, max 500KB |
| Banner image | `images/banner.jpg`, 1280x640px, max 1MB |
| Build output | `dist/` directory with compiled JS |
| README | `README.md` present |
| Tests pass | `bun test` succeeds |

## CLI Commands

```bash
# Scaffold
elizaos create my-plugin --type plugin

# Build
bun run build

# Test
bun test
bun test src/__tests__/actions.test.ts
bun test --watch
bun test --coverage

# ElizaOS test runner
elizaos test --type component
elizaos test --type e2e

# Validate before publish
elizaos publish --test
elizaos publish --dry-run

# First publish (creates GitHub repo + npm package)
elizaos publish
# Requires GitHub PAT with scopes: repo, read:org, workflow

# Subsequent updates (never use elizaos publish again)
npm version patch
bun run build
npm publish
git push origin main

# User installation (after registry approval)
elizaos plugins add plugin-my-plugin
```

### Timeline
- npm package: Available immediately
- GitHub repo: Created immediately
- Registry approval: 1-3 business days
