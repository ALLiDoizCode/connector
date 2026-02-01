import { useEffect, useState } from 'react';
import { unwrapGiftwrap } from '@/lib/nostr-crypto';
import type { Event as NostrEvent } from 'nostr-tools/pure';

export interface ReceivedMessage {
  from: string;
  content: string;
  timestamp: number;
  giftwrap: NostrEvent;
}

export function useMessageReceiver(
  privateKey: Uint8Array | null,
  onMessageReceived: (message: ReceivedMessage) => void
) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!privateKey) return;

    const ws = new WebSocket('ws://localhost:3003');

    ws.onopen = () => {
      // eslint-disable-next-line no-console
      console.log('WebSocket connected to X402 message receiver');
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'giftwrap') {
          // Unwrap giftwrap client-side (3 layers)
          const plaintext = unwrapGiftwrap(data.giftwrap, privateKey);

          const receivedMessage: ReceivedMessage = {
            from: data.giftwrap.tags.find((t: string[]) => t[0] === 'p')?.[1] || 'unknown',
            content: plaintext,
            timestamp: Date.now(),
            giftwrap: data.giftwrap,
          };

          onMessageReceived(receivedMessage);
        }
      } catch (error) {
        console.error('Failed to unwrap message:', error);
        setError('Decryption failed');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error');
      setIsConnected(false);
    };

    ws.onclose = () => {
      // eslint-disable-next-line no-console
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [privateKey, onMessageReceived]);

  return { isConnected, error };
}
