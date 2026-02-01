import { useState, useEffect, useCallback } from 'react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

export function useKeyManager() {
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    // Load private key from localStorage on mount
    const storedNsec = localStorage.getItem('nostr-private-key');
    if (storedNsec) {
      try {
        const decoded = nip19.decode(storedNsec);
        if (decoded.type === 'nsec') {
          setPrivateKey(decoded.data);
          setPublicKey(getPublicKey(decoded.data));
        }
      } catch (error) {
        console.error('Failed to load stored key:', error);
        // Clear invalid key
        localStorage.removeItem('nostr-private-key');
      }
    }
  }, []);

  const generateNewKey = useCallback(() => {
    const newPrivateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(newPrivateKey);

    // Store in localStorage (browser storage only, never sent to server)
    localStorage.setItem('nostr-private-key', nsec);

    setPrivateKey(newPrivateKey);
    setPublicKey(getPublicKey(newPrivateKey));
  }, []);

  const importKey = useCallback((nsec: string) => {
    const decoded = nip19.decode(nsec);
    if (decoded.type === 'nsec') {
      localStorage.setItem('nostr-private-key', nsec);
      setPrivateKey(decoded.data);
      setPublicKey(getPublicKey(decoded.data));
    } else {
      throw new Error('Invalid nsec format');
    }
  }, []);

  const clearKey = useCallback(() => {
    localStorage.removeItem('nostr-private-key');
    setPrivateKey(null);
    setPublicKey(null);
  }, []);

  return {
    privateKey,
    publicKey,
    npub: publicKey ? nip19.npubEncode(publicKey) : null,
    nsec: privateKey ? nip19.nsecEncode(privateKey) : null,
    generateNewKey,
    importKey,
    clearKey,
  };
}
