/**
 * Dynamically import an optional dependency with a clear error message.
 * Used for dependencies that are peerDependencies or optionalDependencies.
 */
export async function requireOptional<T>(packageName: string, feature: string): Promise<T> {
  try {
    return (await import(packageName)) as T;
  } catch {
    throw new Error(
      `${packageName} is required for ${feature}. Install it with: npm install ${packageName}`
    );
  }
}
