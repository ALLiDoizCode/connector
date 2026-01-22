/**
 * Isolated Test Environment Utility
 *
 * Provides automatic setup and teardown of isolated test environments
 * to prevent test pollution and ensure test isolation.
 *
 * Usage:
 * ```typescript
 * let env: IsolatedTestEnv;
 *
 * beforeEach(async () => {
 *   env = new IsolatedTestEnv();
 *   await env.setup();
 * });
 *
 * afterEach(async () => {
 *   await env.teardown();
 * });
 *
 * it('should do something', () => {
 *   const dbPath = env.getPath('test.db');
 *   // ... use dbPath
 * });
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CleanupFunction {
  (): void | Promise<void>;
}

export interface ComponentWithClose {
  close?: () => void | Promise<void>;
}

export class IsolatedTestEnv {
  private tempDir: string | null = null;
  private cleanupFns: CleanupFunction[] = [];
  private components: Map<string, ComponentWithClose> = new Map();
  private isSetup = false;
  private isTornDown = false;

  /**
   * Set up the isolated test environment
   * Creates a unique temporary directory for this test
   */
  async setup(): Promise<string> {
    if (this.isSetup) {
      throw new Error('IsolatedTestEnv is already set up. Call teardown() first.');
    }

    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-isolated-'));
    this.isSetup = true;
    this.isTornDown = false;

    return this.tempDir;
  }

  /**
   * Get the temporary directory path
   * @throws Error if setup() has not been called
   */
  getTempDir(): string {
    if (!this.tempDir) {
      throw new Error('IsolatedTestEnv not set up. Call setup() first.');
    }
    return this.tempDir;
  }

  /**
   * Get a path within the temporary directory
   * @param name - File or directory name
   * @returns Full path within the temp directory
   */
  getPath(name: string): string {
    return path.join(this.getTempDir(), name);
  }

  /**
   * Get a database path within the temporary directory
   * @param name - Database name (without extension)
   * @returns Full path to the database file
   */
  getDbPath(name: string = 'test'): string {
    return this.getPath(`${name}.db`);
  }

  /**
   * Get a path for encrypted seed storage
   * @param name - Seed file name (without extension)
   * @returns Full path to the seed file
   */
  getSeedPath(name: string = 'master-seed'): string {
    return this.getPath(`${name}.enc`);
  }

  /**
   * Create a subdirectory within the temp directory
   * @param name - Directory name
   * @returns Full path to the created directory
   */
  createSubDir(name: string): string {
    const dirPath = this.getPath(name);
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }

  /**
   * Register a cleanup function to be called during teardown
   * Cleanup functions are called in reverse order (LIFO)
   * @param fn - Cleanup function
   */
  registerCleanup(fn: CleanupFunction): void {
    this.cleanupFns.push(fn);
  }

  /**
   * Register a component that has a close() method
   * Components are closed in reverse order during teardown
   * @param name - Unique name for the component (for debugging)
   * @param component - Component with optional close() method
   */
  registerComponent(name: string, component: ComponentWithClose): void {
    if (this.components.has(name)) {
      console.warn(`Component '${name}' is already registered. Overwriting.`);
    }
    this.components.set(name, component);
  }

  /**
   * Unregister a component (useful if you manually close it)
   * @param name - Component name
   */
  unregisterComponent(name: string): void {
    this.components.delete(name);
  }

  /**
   * Clean up all files in the temp directory without tearing down
   * Useful for resetting state between test phases
   */
  async cleanFiles(): Promise<void> {
    if (!this.tempDir || !fs.existsSync(this.tempDir)) {
      return;
    }

    const files = fs.readdirSync(this.tempDir);
    for (const file of files) {
      const filePath = path.join(this.tempDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }

  /**
   * Tear down the isolated test environment
   * - Closes all registered components (in reverse order)
   * - Runs all cleanup functions (in reverse order)
   * - Deletes the temporary directory
   */
  async teardown(): Promise<void> {
    if (this.isTornDown) {
      return; // Already torn down, idempotent
    }

    // Close all registered components in reverse order
    const componentEntries = Array.from(this.components.entries()).reverse();
    for (const [name, component] of componentEntries) {
      if (component.close) {
        try {
          await component.close();
        } catch (error) {
          console.warn(`Error closing component '${name}':`, error);
        }
      }
    }
    this.components.clear();

    // Run all cleanup functions in reverse order
    const cleanups = [...this.cleanupFns].reverse();
    for (const fn of cleanups) {
      try {
        await fn();
      } catch (error) {
        console.warn('Error in cleanup function:', error);
      }
    }
    this.cleanupFns = [];

    // Delete the temporary directory
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Error deleting temp directory:', error);
      }
    }

    this.tempDir = null;
    this.isSetup = false;
    this.isTornDown = true;
  }

  /**
   * Check if the environment is currently set up
   */
  isActive(): boolean {
    return this.isSetup && !this.isTornDown;
  }
}

/**
 * Create a Jest helper that automatically manages IsolatedTestEnv
 * @returns Object with env instance and beforeEach/afterEach setup
 */
export function createIsolatedTestHelper(): {
  env: IsolatedTestEnv;
  setupBeforeEach: () => Promise<void>;
  teardownAfterEach: () => Promise<void>;
} {
  const env = new IsolatedTestEnv();

  return {
    env,
    setupBeforeEach: async () => {
      await env.setup();
    },
    teardownAfterEach: async () => {
      await env.teardown();
    },
  };
}
