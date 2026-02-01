# Epic 32 UI/UX Design: Private Messaging Demo

**Complete interface design for client-side E2EE giftwrap messaging over ILP**

---

## Main Interface Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ 🔐 Private ILP Messenger                          [Settings] [?]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ┌─────────────────────┐  ┌────────────────────────────────────┐  │
│ │  LEFT SIDEBAR       │  │  MAIN CHAT AREA                    │  │
│ │  (Contacts & Keys)  │  │                                     │  │
│ │                     │  │  ┌──────────────────────────────┐  │  │
│ │ 🔑 Your Identity    │  │  │  Chat with Bob                │  │  │
│ │ ┌─────────────────┐ │  │  │  Status: 🟢 Online           │  │  │
│ │ │ Alice           │ │  │  └──────────────────────────────┘  │  │
│ │ │ npub1abc...xyz  │ │  │                                     │  │
│ │ │ 🔒 Encrypted    │ │  │  ┌──────────────────────────────┐  │  │
│ │ └─────────────────┘ │  │  │ Message History              │  │  │
│ │                     │  │  │                               │  │  │
│ │ 💬 Conversations    │  │  │ [Bob] Hey Alice!             │  │  │
│ │ ┌─────────────────┐ │  │  │ 🔒 Encrypted • 2:30 PM       │  │  │
│ │ │ Bob             │ │  │  │                               │  │  │
│ │ │ 3 messages      │ │  │  │ [You] Hi Bob! Secret deal... │  │  │
│ │ │ 🟢 Online       │ │  │  │ 🔒 Encrypted • ✅ Delivered  │  │  │
│ │ └─────────────────┘ │  │  │ 💰 300 msat • 2:31 PM        │  │  │
│ │ ┌─────────────────┐ │  │  │                               │  │  │
│ │ │ Carol           │ │  │  │                               │  │  │
│ │ │ 1 message       │ │  │  └──────────────────────────────┘  │  │
│ │ │ 🔴 Offline      │ │  │                                     │  │
│ │ └─────────────────┘ │  │  ┌──────────────────────────────┐  │  │
│ │                     │  │  │ Compose Message              │  │  │
│ │ [+ New Chat]        │  │  │                               │  │  │
│ │                     │  │  │ Type your message...         │  │  │
│ │                     │  │  │                               │  │  │
│ │                     │  │  │ [Attach] [Emoji]      [Send] │  │  │
│ │                     │  │  └──────────────────────────────┘  │  │
│ └─────────────────────┘  └────────────────────────────────────┘  │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│ 🔐 ENCRYPTION INSPECTOR (Educational Panel - Expandable)          │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ 📊 Message Layers (NIP-59)              [Show/Hide Details]  │  │
│ │                                                               │  │
│ │ Layer 3: 🎁 Gift Wrap (kind 1059)                           │  │
│ │ ├─ Pubkey: abc123... (ephemeral) ✅ Anonymous                │  │
│ │ ├─ Timestamp: Randomized ±2 days ✅ Metadata protected       │  │
│ │ └─ Content: [Encrypted Seal] 🔒                              │  │
│ │                                                               │  │
│ │ Layer 2: 📜 Seal (kind 13)                                   │  │
│ │ ├─ Pubkey: alice123... (your real key) ✅ Authenticated      │  │
│ │ ├─ Signature: def456... ✅ Signed by you                     │  │
│ │ └─ Content: [Encrypted Rumor] 🔒                             │  │
│ │                                                               │  │
│ │ Layer 1: 💬 Rumor (kind 14)                                  │  │
│ │ ├─ Content: "Hey Bob! Secret deal..." ✅ Your message        │  │
│ │ ├─ Signature: NONE ✅ Deniable                               │  │
│ │ └─ Recipient knows it's from you, but can't prove it         │  │
│ └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ 💰 PAYMENT ROUTING VISUALIZATION (Bottom Panel)                   │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ Message Route: Alice → Bob (300 msat total)                  │  │
│ │                                                               │  │
│ │  You        Facilitator    Connector1    Connector2     Bob  │  │
│ │  👤  ────►  🌐  ────►      🔀  ────►     🔀  ────►      👤  │  │
│ │            -50msat        -100msat      -100msat       +50   │  │
│ │                                                               │  │
│ │  Status: ✅ Delivered in 4.2 seconds                         │  │
│ │  Privacy: 🔒 Content encrypted • 🎭 Sender anonymous         │  │
│ │  Cost Breakdown: Gateway 50 + Relay 100 + Relay 100 + Delivery 50 │
│ └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown (shadcn-ui)

### 1. Main Chat Interface

```typescript
// packages/connector/explorer-ui/src/pages/PrivateMessenger.tsx
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export function PrivateMessenger() {
  const [selectedContact, setSelectedContact] = useState('bob');
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [encryptionDetails, setEncryptionDetails] = useState<EncryptionLayers | null>(null);

  return (
    <div className="flex h-screen">
      {/* Left Sidebar */}
      <LeftSidebar
        contacts={contacts}
        onSelectContact={setSelectedContact}
      />

      {/* Main Chat Area */}
      <MainChatArea
        contact={selectedContact}
        messages={messages}
        onSendMessage={handleSendMessage}
      />

      {/* Bottom Panels (Expandable) */}
      <BottomPanels
        encryptionLayers={encryptionDetails}
        routingVisualization={routingData}
      />
    </div>
  );
}
```

---

### 2. Key Management Panel

```typescript
// components/KeyManager.tsx
import { Lock, Eye, EyeOff, Key } from 'lucide-react';

export function KeyManager() {
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKey, setPrivateKey] = useState('');

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Your Identity
        </CardTitle>
        <CardDescription>
          Private key stored securely in your browser
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Public Key Display */}
        <div>
          <label className="text-sm font-medium">Public Key (npub)</label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={nip19.npubEncode(publicKey)}
              readOnly
              className="font-mono text-sm"
            />
            <Button variant="outline" size="icon" onClick={copyPublicKey}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Private Key (Hidden by Default) */}
        <div>
          <label className="text-sm font-medium">Private Key (nsec)</label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type={showPrivateKey ? "text" : "password"}
              value={privateKey ? nip19.nsecEncode(privateKey) : "Not loaded"}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
            >
              {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Security Indicator */}
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
          <Lock className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-700 dark:text-green-400">
            🔒 Key never leaves your browser
          </span>
        </div>

        {/* Import/Generate Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={generateNewKey} className="flex-1">
            Generate New Key
          </Button>
          <Button variant="outline" onClick={importKey} className="flex-1">
            Import Key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

### 3. Message Composer with Encryption Indicator

```typescript
// components/MessageComposer.tsx
import { Send, Lock, Shield } from 'lucide-react';

export function MessageComposer({
  recipient,
  onSend
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus>('idle');

  const handleSend = async () => {
    setIsEncrypting(true);
    setEncryptionStatus('creating-rumor');

    try {
      // 1. Create rumor (client-side!)
      const rumor = createRumor(message, recipient);
      setEncryptionStatus('sealing');

      // 2. Create seal (client-side!)
      const seal = await createSeal(rumor, recipient.pubkey, privateKey);
      setEncryptionStatus('wrapping');

      // 3. Create giftwrap (client-side!)
      const giftwrap = await wrapSeal(seal, recipient.pubkey);
      setEncryptionStatus('sending');

      // 4. Send to X402 server
      await sendGiftwrap(giftwrap, recipient.address, 300);

      setEncryptionStatus('delivered');
      setMessage('');
      onSend();

    } catch (error) {
      setEncryptionStatus('error');
    } finally {
      setIsEncrypting(false);
    }
  };

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

        {/* Message Input */}
        <Textarea
          placeholder="Type your message... (will be encrypted locally)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[100px] resize-none"
          disabled={isEncrypting}
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
            <Badge variant="secondary">300 msat</Badge>
          </div>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isEncrypting}
          >
            <Send className="h-4 w-4 mr-2" />
            Send Encrypted
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const encryptionStatusText = {
  'idle': 'Ready to send',
  'creating-rumor': '🔐 Creating unsigned message (Layer 1)...',
  'sealing': '🔒 Encrypting with your key (Layer 2)...',
  'wrapping': '🎁 Wrapping with ephemeral key (Layer 3)...',
  'sending': '📤 Routing through ILP network...',
  'delivered': '✅ Delivered!',
  'error': '❌ Failed to send'
};
```

---

### 4. Encryption Inspector (Educational Panel)

```typescript
// components/EncryptionInspector.tsx
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function EncryptionInspector({
  message
}: { message: EncryptedMessage }) {
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
          <CardDescription>
            Your message is protected by 3 layers of encryption
          </CardDescription>
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
                  <span className="font-mono">{message.giftwrap.pubkey.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sender:</span>
                  <Badge variant="secondary">Ephemeral (Anonymous)</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timestamp:</span>
                  <Badge variant="secondary">Randomized ±2 days</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-purple-50 dark:bg-purple-950 rounded">
                  <span className="text-xs text-purple-700 dark:text-purple-400">
                    ✅ Metadata protected - relays can't track you
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
                  <span className="font-mono">{yourPubkey.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signed by:</span>
                  <Badge variant="secondary">You (Alice)</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Encrypted to:</span>
                  <Badge variant="secondary">Bob's pubkey</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-blue-50 dark:bg-blue-950 rounded">
                  <span className="text-xs text-blue-700 dark:text-blue-400">
                    ✅ Bob knows it's from you, but can't prove it to others
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
                  <span className="italic">"{message.rumor.content.slice(0, 30)}..."</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signature:</span>
                  <Badge variant="destructive">NONE (Unsigned)</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 p-2 bg-green-50 dark:bg-green-950 rounded">
                  <span className="text-xs text-green-700 dark:text-green-400">
                    ✅ Deniable - you can't be legally proven as the author
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
                  <span>Destination: g.agent.bob.private</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Payment: 300 msat</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Encrypted blob: 748 bytes</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>❌</span>
                  <span className="line-through">Message content</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>❌</span>
                  <span className="line-through">Real sender (ephemeral key)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
```

---

### 5. Payment Routing Visualization

```typescript
// components/RoutingVisualization.tsx
import { ArrowRight, CheckCircle, Clock } from 'lucide-react';
import { Progress } from "@/components/ui/progress";

export function RoutingVisualization({
  route
}: { route: RouteData }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          💰 Payment Route
        </CardTitle>
        <CardDescription>
          Message routed through {route.hops.length} hops in {route.latency}ms
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Route Diagram */}
        <div className="flex items-center justify-between mb-6">
          {route.hops.map((hop, index) => (
            <React.Fragment key={hop.id}>
              {/* Hop Node */}
              <div className="flex flex-col items-center">
                <Avatar className={hop.status === 'completed' ? 'ring-2 ring-green-500' : ''}>
                  <AvatarFallback>{hop.icon}</AvatarFallback>
                </Avatar>

                <div className="text-xs font-medium mt-2">{hop.name}</div>

                <div className="text-xs text-muted-foreground mt-1">
                  {hop.fee > 0 ? `-${hop.fee} msat` : `+${Math.abs(hop.fee)} msat`}
                </div>

                <div className="mt-1">
                  {hop.status === 'completed' && (
                    <Badge variant="outline" className="text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Done
                    </Badge>
                  )}
                  {hop.status === 'processing' && (
                    <Badge variant="outline" className="text-blue-600">
                      <Clock className="h-3 w-3 mr-1 animate-spin" />
                      Processing
                    </Badge>
                  )}
                </div>
              </div>

              {/* Arrow Between Hops */}
              {index < route.hops.length - 1 && (
                <div className="flex flex-col items-center">
                  <ArrowRight className={`h-6 w-6 ${
                    hop.status === 'completed' ? 'text-green-500' : 'text-gray-300'
                  }`} />
                  <div className="text-xs text-muted-foreground mt-1">
                    {route.hops[index + 1].amount} msat
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Progress Bar */}
        <Progress
          value={route.progress}
          className="h-2 mb-4"
        />

        {/* Cost Breakdown */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <div>
            <div className="text-xs text-muted-foreground">Total Cost</div>
            <div className="text-lg font-bold">300 msat</div>
            <div className="text-xs text-muted-foreground">~$0.03 USD</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Delivery Time</div>
            <div className="text-lg font-bold">{route.latency}ms</div>
            <div className="text-xs text-muted-foreground">Including privacy delays</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Privacy Level</div>
            <div className="flex items-center gap-1">
              <Badge variant="secondary">🔒 High</Badge>
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Delivery Proof</div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">ILP Fulfill</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Complete User Flow

### First-Time Setup (30 seconds)

```
1. User opens app
   ↓
2. Sees "Welcome" screen
   ↓
3. Clicks "Generate New Key" or "Import Existing Key"
   ↓
4. Key stored in browser localStorage
   ↓
5. Shows public key (npub) for sharing
   ↓
6. Ready to chat! ✅
```

### Sending a Message (10 seconds)

```
1. Select contact from sidebar (or enter pubkey)
   ↓
2. Type message in composer
   ↓
3. Click "Send Encrypted" button
   ↓
4. Watch encryption progress:
   - 🔐 Creating rumor...
   - 🔒 Sealing...
   - 🎁 Wrapping...
   - 📤 Sending...
   ↓
5. See routing visualization update in real-time:
   - You → Facilitator (animated arrow)
   - Facilitator → Connector1 (animated arrow)
   - Connector1 → Connector2 (animated arrow)
   - Connector2 → Bob (animated arrow)
   ↓
6. ✅ "Delivered!" confirmation
   ↓
7. Message appears in chat with:
   - 🔒 Encrypted badge
   - ✅ Delivered checkmark
   - 💰 300 msat cost
   - ⏱️ Timestamp
```

### Receiving a Message (Instant)

```
1. Bob's app connected via WebSocket to X402 server
   ↓
2. Server receives ILP packet for Bob
   ↓
3. Server forwards to Bob's browser via WebSocket
   ↓
4. Bob's browser (client-side JavaScript):
   - TOON decodes packet
   - Unwraps giftwrap with Bob's private key
   - Unseals seal with Bob's private key
   - Extracts rumor
   ↓
5. Message appears in Bob's chat:
   [Alice] "Hey Bob! Secret deal..."
   🔒 Encrypted • 2:31 PM
   ↓
6. Bob can click encryption inspector to see layers
```

---

## Demo Script (5 Minutes)

### Minute 1: Introduction

**Narrator:** "Today we're demonstrating Epic 32: Private messaging with end-to-end encryption using NIP-59 giftwrap, routed through ILP payment channels."

**Screen:** Show main interface with Alice logged in

**Highlight:**

- "Alice's private key is stored in her browser - the server never sees it"
- Point to green "🔒 Key never leaves your browser" indicator

---

### Minute 2: Sending a Message

**Narrator:** "Alice wants to send Bob a confidential message about a business deal."

**Action:** Type in composer: "Hey Bob, I can provide liquidity for your trade at $2.52"

**Narrator:** "Watch what happens when Alice clicks 'Send Encrypted':"

**Screen:** Show encryption status updates in real-time:

1. "🔐 Creating unsigned message (Layer 1)..."
2. "🔒 Encrypting with your key (Layer 2)..."
3. "🎁 Wrapping with ephemeral key (Layer 3)..."
4. "📤 Routing through ILP network..."

**Highlight:** "All encryption happens in Alice's browser - the message is already encrypted before it reaches our servers!"

---

### Minute 3: Payment Routing

**Narrator:** "Now the encrypted message routes through the ILP network."

**Screen:** Show routing visualization animating:

- Alice → Facilitator (50 msat fee)
- Facilitator → Connector1 (100 msat fee)
- Connector1 → Connector2 (100 msat fee)
- Connector2 → Bob (50 msat delivery bonus)

**Highlight:**

- "Each hop takes a small fee for the relay service"
- "Random delays at each hop protect timing privacy"
- "Total cost: 300 millisatoshis - about 3 cents"

---

### Minute 4: Encryption Inspector

**Narrator:** "Let's examine what each layer protects."

**Action:** Click "Show Details" on Encryption Inspector

**Screen:** Expand all 3 layers

**Highlight:**

- **Layer 3 (Gift Wrap):** "Ephemeral key hides Alice's identity"
- **Layer 2 (Seal):** "Signed by Alice - Bob knows it's from her, but can't prove it to others"
- **Layer 1 (Rumor):** "Unsigned - provides legal deniability"

**Narrator:** "Notice the 'What Connectors See' section - they see the destination and payment, but NOT the content or real sender."

---

### Minute 5: Delivery Confirmation

**Narrator:** "Bob receives the message instantly."

**Screen:** Switch to Bob's view, show message appearing in his inbox

**Action:** Click on message to show encryption inspector from Bob's perspective

**Highlight:**

- Bob's browser unwraps the 3 layers automatically
- Bob sees: "✅ Delivered" with ILP Fulfill proof
- Bob can read the plaintext message

**Narrator:** "And that's Epic 32! End-to-end encrypted private messaging with cryptographic payment routing through ILP."

**Final Screen:** Show side-by-side:

- Alice's sent message: "🔒 Encrypted • ✅ Delivered • 💰 300 msat"
- Bob's received message: "🔒 Encrypted • From Alice • 2:31 PM"

---

## Key UI Features Summary

### 1. **Security Indicators** ✅

- 🔒 "Key never leaves browser" badge
- 🔐 Encryption progress (real-time)
- ✅ Delivery confirmation (ILP Fulfill proof)
- 🎭 Anonymous sender indicator (ephemeral key)

### 2. **Educational Elements** 📚

- Encryption Inspector (shows 3 layers)
- Routing Visualization (shows payment hops)
- "What Connectors See" section (privacy transparency)
- Cost breakdown (shows fee distribution)

### 3. **UX Simplicity** 🎯

- Familiar chat interface (like WhatsApp/Signal)
- One-click message sending
- Clear visual feedback (animations, progress bars)
- Helpful tooltips and descriptions

### 4. **Demo-Ready** 🎬

- Expandable panels (hide complexity when not needed)
- Real-time animations (watch payment flow)
- Side-by-side Alice/Bob views (show both perspectives)
- Screenshot-friendly (looks great in presentations)

---

## File Structure

```
packages/connector/explorer-ui/src/
├── pages/
│   └── PrivateMessenger.tsx         # Main app page
├── components/
│   ├── KeyManager.tsx               # Private key management
│   ├── MessageComposer.tsx          # Message input + encryption
│   ├── MessageList.tsx              # Chat history
│   ├── EncryptionInspector.tsx      # Layer visualization
│   ├── RoutingVisualization.tsx     # Payment flow diagram
│   ├── ContactSidebar.tsx           # Contact list
│   └── MessageBubble.tsx            # Individual message
├── hooks/
│   ├── useGiftwrap.ts               # Client-side NIP-59 creation
│   ├── useX402Client.ts             # HTTP API for routing
│   └── useWebSocket.ts              # Real-time message receive
└── lib/
    ├── nostr-crypto.ts              # NIP-59 wrapper
    └── ilp-client.ts                # X402 HTTP client
```

---

Want me to implement the complete code for any of these components? I can start with the main `PrivateMessenger.tsx` and the client-side `useGiftwrap.ts` hook! 🎯
