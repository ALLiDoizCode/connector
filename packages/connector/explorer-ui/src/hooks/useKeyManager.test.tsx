// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { useKeyManager } from './useKeyManager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useKeyManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('should generate new key and store in localStorage', () => {
    const { result } = renderHook(() => useKeyManager());

    act(() => {
      result.current.generateNewKey();
    });

    // Verify key generated
    expect(result.current.publicKey).toBeTruthy();
    expect(result.current.privateKey).toBeTruthy();
    expect(result.current.npub).toMatch(/^npub1/);
    expect(result.current.nsec).toMatch(/^nsec1/);

    // Verify stored in localStorage
    const storedNsec = localStorage.getItem('nostr-private-key');
    expect(storedNsec).toBeTruthy();
    expect(storedNsec).toMatch(/^nsec1/);
  });

  it('should load existing key from localStorage on mount', () => {
    // Pre-populate localStorage
    const existingKey = generateSecretKey();
    const existingNsec = nip19.nsecEncode(existingKey);
    localStorage.setItem('nostr-private-key', existingNsec);

    const { result } = renderHook(() => useKeyManager());

    // Verify key loaded
    expect(result.current.nsec).toBe(existingNsec);
    expect(result.current.publicKey).toBe(getPublicKey(existingKey));
  });

  it('should clear key from localStorage', () => {
    const { result } = renderHook(() => useKeyManager());

    // Generate key first
    act(() => {
      result.current.generateNewKey();
    });
    expect(localStorage.getItem('nostr-private-key')).toBeTruthy();

    // Clear key
    act(() => {
      result.current.clearKey();
    });

    expect(result.current.privateKey).toBeNull();
    expect(localStorage.getItem('nostr-private-key')).toBeNull();
  });

  it('should import key from nsec format', () => {
    const { result } = renderHook(() => useKeyManager());

    const testKey = generateSecretKey();
    const testNsec = nip19.nsecEncode(testKey);

    act(() => {
      result.current.importKey(testNsec);
    });

    expect(result.current.nsec).toBe(testNsec);
    expect(result.current.publicKey).toBe(getPublicKey(testKey));
    expect(localStorage.getItem('nostr-private-key')).toBe(testNsec);
  });

  it('should throw error on invalid nsec format', () => {
    const { result } = renderHook(() => useKeyManager());

    expect(() => {
      act(() => {
        result.current.importKey('invalid-nsec');
      });
    }).toThrow();
  });

  it('should handle corrupted localStorage data gracefully', () => {
    // Store invalid data
    localStorage.setItem('nostr-private-key', 'corrupted-data');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useKeyManager());

    // Should not throw, should clear invalid data
    expect(result.current.privateKey).toBeNull();
    expect(localStorage.getItem('nostr-private-key')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
