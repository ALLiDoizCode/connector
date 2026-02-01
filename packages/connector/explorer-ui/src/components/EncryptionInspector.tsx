import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Info, ChevronDown, ChevronUp, Shield } from 'lucide-react';

interface NostrEvent {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags?: string[][];
  id?: string;
  sig?: string;
}

interface EncryptionInspectorProps {
  giftwrap: NostrEvent; // Kind 1059 gift wrap event
  seal: NostrEvent; // Kind 13 seal event (decrypted from giftwrap)
  rumor: NostrEvent; // Kind 14 rumor event (decrypted from seal)
  yourPubkey: string; // Current user's pubkey (for "You" label)
  recipientPubkey: string; // Recipient's pubkey
  recipientName?: string; // Recipient's display name (optional)
}

function calculateBlobSize(giftwrap: NostrEvent): number {
  // TOON encoding reduces JSON size by ~40%
  const jsonSize = JSON.stringify(giftwrap).length;
  return Math.round(jsonSize * 0.6); // Estimate TOON size
}

export function EncryptionInspector({
  giftwrap,
  seal,
  rumor,
  yourPubkey,
  recipientPubkey,
  recipientName,
}: EncryptionInspectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="w-full">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              <CardTitle>Encryption Layers (NIP-59)</CardTitle>
            </div>
            {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </CollapsibleTrigger>
          <CardDescription>Your message is protected by 3 layers of encryption</CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Layer 3: Gift Wrap */}
            <div className="border-l-4 border-purple-500 pl-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Layer 3</Badge>
                <span className="font-semibold">🎁 Gift Wrap (kind 1059)</span>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pubkey:</span>
                  <span className="font-mono">{giftwrap.pubkey.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sender:</span>
                  <Badge variant="secondary">Ephemeral (Anonymous)</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timestamp:</span>
                  <Badge variant="secondary">Randomized ±2 days</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created:</span>
                  <span>{new Date(giftwrap.created_at * 1000).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-purple-50 dark:bg-purple-950 rounded">
                  <span className="text-xs text-purple-700 dark:text-purple-400">
                    ✅ Metadata protected - relays can&apos;t track you
                  </span>
                </div>
              </div>
            </div>

            {/* Layer 2: Seal */}
            <div className="border-l-4 border-blue-500 pl-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Layer 2</Badge>
                <span className="font-semibold">📜 Seal (kind 13)</span>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pubkey:</span>
                  <span className="font-mono">{seal.pubkey.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signed by:</span>
                  <Badge variant="secondary">
                    {seal.pubkey === yourPubkey ? 'You' : seal.pubkey.slice(0, 8) + '...'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Encrypted to:</span>
                  <Badge variant="secondary">
                    {recipientName || recipientPubkey.slice(0, 8) + '...'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signature:</span>
                  <span className="font-mono text-xs">{seal.sig?.slice(0, 16)}...</span>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-blue-50 dark:bg-blue-950 rounded">
                  <span className="text-xs text-blue-700 dark:text-blue-400">
                    ✅ {recipientName || 'Recipient'} knows it&apos;s from you, but can&apos;t prove
                    it to others
                  </span>
                </div>
              </div>
            </div>

            {/* Layer 1: Rumor */}
            <div className="border-l-4 border-green-500 pl-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Layer 1</Badge>
                <span className="font-semibold">💬 Rumor (kind 14)</span>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Content:</span>
                  <span className="italic">&quot;{rumor.content.slice(0, 30)}...&quot;</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kind:</span>
                  <Badge variant="secondary">14 (Private Message)</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signature:</span>
                  <Badge variant="destructive">NONE (Unsigned)</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-green-50 dark:bg-green-950 rounded">
                  <span className="text-xs text-green-700 dark:text-green-400">
                    ✅ Deniable - you can&apos;t be legally proven as the author
                  </span>
                </div>
              </div>
            </div>

            {/* What Connectors See */}
            <Separator />

            <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div className="font-semibold mb-2 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                What ILP Connectors See:
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Destination: {recipientPubkey.slice(0, 12)}... (ILP address)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Payment: 300 M2M</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Encrypted blob: {calculateBlobSize(giftwrap)} bytes</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>❌</span>
                  <span className="line-through text-muted-foreground">Message content</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>❌</span>
                  <span className="line-through text-muted-foreground">
                    Real sender (ephemeral key)
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
