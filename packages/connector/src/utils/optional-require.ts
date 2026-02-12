/**
 * Dynamically load an optional dependency with a clear error message.
 * Tries require() first (CJS), then falls back to import() (ESM).
 * Wraps CJS modules to match ESM shape (adds .default) for consistent usage.
 * Used for dependencies that are peerDependencies or optionalDependencies.
 */
export async function requireOptional<T>(packageName: string, feature: string): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(packageName);
    // Wrap CJS default export so callers can use `{ default: ... }` consistently
    if (mod && typeof mod === 'object' && mod.__esModule) {
      return mod as T;
    }
    return { ...mod, default: mod } as T;
  } catch {
    try {
      return (await import(packageName)) as T;
    } catch {
      throw new Error(
        `${packageName} is required for ${feature}. Install it with: npm install ${packageName}`
      );
    }
  }
}
