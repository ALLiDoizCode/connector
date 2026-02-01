import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Send, Lock, Shield, Loader2 } from 'lucide-react';
import { useGiftwrap } from '@/hooks/useGiftwrap';
import { Contact } from '@/pages/PrivateMessenger';
import { type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools/pure';

interface EncryptionLayers {
  giftwrap: NostrEvent;
  seal: NostrEvent;
  rumor: UnsignedEvent;
}

type EncryptionStatus =
  | 'idle'
  | 'creating-rumor'
  | 'sealing'
  | 'wrapping'
  | 'sending'
  | 'delivered'
  | 'error';

const encryptionStatusText: Record<EncryptionStatus, string> = {
  idle: '🔐 Ready to encrypt',
  'creating-rumor': '🔐 Creating rumor (Layer 1)...',
  sealing: '🔒 Sealing with your key (Layer 2)...',
  wrapping: '🎁 Wrapping with ephemeral key (Layer 3)...',
  sending: '📤 Routing through ILP network...',
  delivered: '✅ Delivered!',
  error: '❌ Failed to send',
};

interface MessageComposerProps {
  recipient: Contact;
  onSend: (data: {
    giftwrap: NostrEvent;
    seal: NostrEvent;
    rumor: UnsignedEvent;
    result: EncryptionLayers;
    plaintextMessage: string;
  }) => void;
  privateKey: Uint8Array | null;
}

export function MessageComposer({ recipient, onSend, privateKey }: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus>('idle');
  const { encrypt } = useGiftwrap(privateKey);

  const handleSend = async () => {
    if (!message.trim() || !recipient || !privateKey) return;

    let layers: EncryptionLayers | null = null; // Declare outside try block

    try {
      // Step 1: Create rumor
      setEncryptionStatus('creating-rumor');
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 2: Seal
      setEncryptionStatus('sealing');
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 3: Wrap (actual encryption) - returns all 3 layers
      setEncryptionStatus('wrapping');
      layers = await encrypt(message, recipient.pubkey);

      // Step 4: Send via X402 gateway
      setEncryptionStatus('sending');
      const response = await fetch('http://localhost:3002/api/route-giftwrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giftwrap: layers.giftwrap,
          recipient: recipient.ilpAddress,
          amount: 300,
        }),
      });

      if (!response.ok) throw new Error('Failed to send message');

      const result = await response.json();

      setEncryptionStatus('delivered');
      setTimeout(() => {
        setEncryptionStatus('idle');
        const sentMessage = message;
        setMessage('');
        // Pass all 3 layers to parent
        onSend({
          giftwrap: layers.giftwrap,
          seal: layers.seal,
          rumor: layers.rumor,
          result,
          plaintextMessage: sentMessage,
        });
      }, 1500);
    } catch (error) {
      console.error('Send failed:', error);
      setEncryptionStatus('error');

      // Even on error, pass encryption layers to parent for demonstration
      // This allows users to inspect the encryption even if network fails
      if (layers) {
        const sentMessage = message;
        onSend({
          giftwrap: layers.giftwrap,
          seal: layers.seal,
          rumor: layers.rumor,
          result: { success: false },
          plaintextMessage: sentMessage,
        });
      }

      setTimeout(() => setEncryptionStatus('idle'), 3000);
    }
  };

  const isEncrypting = encryptionStatus !== 'idle' && encryptionStatus !== 'error';

  return (
    <Card>
      <CardContent className="p-4">
        {/* Encryption Status Banner */}
        {isEncrypting && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-600 animate-pulse" />
              <span className="text-sm text-blue-700 dark:text-blue-400">
                {encryptionStatusText[encryptionStatus]}
              </span>
            </div>
          </div>
        )}

        {encryptionStatus === 'error' && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950 rounded-lg">
            <span className="text-sm text-red-700 dark:text-red-400">
              {encryptionStatusText.error}
            </span>
          </div>
        )}

        {/* Message Input */}
        <Textarea
          placeholder="Type your message... (will be encrypted locally)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[100px] resize-none"
          disabled={isEncrypting}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />

        {/* Footer */}
        <div className="flex items-center justify-between mt-4">
          {/* Encryption Indicator */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            <span>End-to-end encrypted</span>
          </div>

          {/* Cost Display */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Cost:</span>
            <Badge variant="secondary">300 M2M</Badge>
          </div>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isEncrypting || !recipient || !privateKey}
          >
            {isEncrypting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Encrypted
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
