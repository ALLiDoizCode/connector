import { useState, useCallback } from 'react';
import { type Event as NostrEvent } from 'nostr-tools/pure';
import { createGiftwrap, unwrapGiftwrap, extractGiftwrapLayers } from '../lib/nostr-crypto';
import type { EncryptionStatus } from '../lib/types/giftwrap';

export function useGiftwrap(privateKey: Uint8Array | null) {
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus>('idle');
  const [lastGiftwrap, setLastGiftwrap] = useState<NostrEvent | null>(null);

  const encrypt = useCallback(
    async (message: string, recipientPubkey: string) => {
      if (!privateKey) throw new Error('No private key available');

      setEncryptionStatus('creating-rumor'); // Status: Layer 1
      await new Promise((resolve) => setTimeout(resolve, 200)); // Simulate processing

      setEncryptionStatus('sealing'); // Status: Layer 2
      await new Promise((resolve) => setTimeout(resolve, 200));

      setEncryptionStatus('wrapping'); // Status: Layer 3
      const layers = createGiftwrap(message, recipientPubkey, privateKey);

      setLastGiftwrap(layers.giftwrap);
      setEncryptionStatus('complete');

      return layers; // Return all 3 layers
    },
    [privateKey]
  );

  const decrypt = useCallback(
    async (giftwrap: NostrEvent) => {
      if (!privateKey) throw new Error('No private key available');

      setEncryptionStatus('unwrapping'); // Status: Decrypting Layer 3
      await new Promise((resolve) => setTimeout(resolve, 100));

      setEncryptionStatus('unsealing'); // Status: Decrypting Layer 2
      await new Promise((resolve) => setTimeout(resolve, 100));

      const plaintext = unwrapGiftwrap(giftwrap, privateKey);

      setEncryptionStatus('complete');
      return plaintext;
    },
    [privateKey]
  );

  const extractLayers = useCallback(
    (giftwrap: NostrEvent) => {
      if (!privateKey) throw new Error('No private key available');
      return extractGiftwrapLayers(giftwrap, privateKey);
    },
    [privateKey]
  );

  return {
    encrypt,
    decrypt,
    extractLayers,
    encryptionStatus,
    lastGiftwrap,
  };
}
