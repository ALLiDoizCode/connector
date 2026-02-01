# Epic 32: Private Messaging Demo Script

**5-Minute Narrated Walkthrough**

This demo showcases end-to-end encrypted private messaging with NIP-59 giftwrap routing over the Interledger Protocol. All encryption happens client-side in the browser—the server never sees your private keys or plaintext messages.

---

## Prerequisites

Before starting, ensure the demo is running:

```bash
./scripts/run-messaging-demo.sh
```

Wait for the message:

```
✅ Demo is Ready!
```

---

## Minute 1: Introduction (60 seconds)

### What You'll See

Open the main interface at **http://localhost:5173/messenger**

![Private Messenger Initial State](./.playwright-mcp/messenger-initial-state.png)

### Key Points to Explain

**🔒 Client-Side Encryption**

- All encryption happens **in your browser**
- Private keys stored in browser localStorage only
- Server **never sees** your private keys or plaintext messages

**Key Manager Panel** (Top right)

- Shows Alice's `npub...` (Nostr public key)
- Green badge: **"🔒 Key never leaves browser"**
- Private key: 32 bytes of entropy, never transmitted

**Privacy Guarantee**

> "Even if the server is compromised, attackers cannot read your messages because encryption happens client-side before sending."

### First-Time Setup

If you see "No private key found":

1. Click **"Generate New Key"** button
2. New 32-byte private key generated in browser
3. Public key (npub) displayed automatically
4. Private key saved to `localStorage` (browser-only)

![Key Manager Generated](./.playwright-mcp/key-manager-generated.png)

---

## Minute 2: Send Message (60 seconds)

### Add a Contact (First Time Only)

1. Click **"Add Contact"** button in sidebar
2. Enter Bob's details:
   - **Name:** Bob
   - **Nostr Public Key (npub):** `npub1...` (Bob's npub from second browser tab)
   - **ILP Address:** `g.agent.bob.private`
3. Click **"Add Contact"**

![Add Contact Form](./.playwright-mcp/messenger-add-contact-form.md)

Bob appears in the sidebar:

![Messenger with Contact](./.playwright-mcp/messenger-with-contact.png)

### Compose and Send

1. Type your message in the composer:

   ```
   Hey Bob, confidential project update - we're shipping Epic 32!
   ```

2. Click **"Send Encrypted"** button

### Watch Real-Time Encryption Status

The UI updates show the encryption process:

- **Step 1:** 🔐 Creating rumor (Layer 1)...
  - Unsigned plaintext note (kind 1)
  - Contains your message content

- **Step 2:** 🔒 Sealing with your key (Layer 2)...
  - Encrypts rumor to Bob's pubkey (NIP-44)
  - Signed with your private key (proof of sender)

- **Step 3:** 🎁 Wrapping with ephemeral key (Layer 3)...
  - Ephemeral private key generated
  - Encrypts seal to Bob's pubkey (hides sender identity)
  - Timestamp randomized ±2 days

- **Step 4:** 📤 Routing through ILP network...
  - TOON encoding (40% smaller than JSON)
  - HTTP POST to X402 gateway
  - Multi-hop ILP routing: Facilitator → C1 → C2 → Bob

- **Step 5:** ✅ Delivered!
  - ILP Fulfill received (cryptographic delivery proof)

### Message Appears in Chat History

Your sent message displays with status badges:

```
🔒 Encrypted • ✅ Delivered • 💰 300 msat • ⏱ 4.2s
```

**Badge Meanings:**

- 🔒 **Encrypted** - Message encrypted client-side with NIP-59
- ✅ **Delivered** - ILP Fulfill received (proof of delivery)
- 💰 **300 msat** - Total cost distributed across 4 parties
- ⏱ **4.2s** - Round-trip latency (including privacy delays)

---

## Minute 3: Routing Visualization (60 seconds)

### Open Routing Visualization Panel

Scroll down to **"Payment Routing Visualization"** panel below the message composer.

![Routing Visualization Processing](./.playwright-mcp/routing-visualization-processing.png)

### Topology Display

You'll see the 3-hop network topology:

```
You (Alice)
    ↓
Facilitator (g.facilitator)
    ↓
Connector 1 (g.connector1)
    ↓
Connector 2 (g.connector2)
    ↓
Bob (g.agent.bob.private)
```

### Watch the Animation

**As your message routes:**

1. **Gray arrows** - Packet not yet sent
2. **Arrows animate from gray → green** - Packet flowing through hops
3. **Progress bar updates:**
   - 0% → 25% → 50% → 75% → 100%

**Timeline:**

- **0.0s** - Prepare sent to Facilitator
- **1.2s** - Prepare forwarded to Connector1
- **2.4s** - Prepare forwarded to Connector2
- **3.6s** - Prepare delivered to Bob
- **4.2s** - Fulfill returned to Alice (✅ Delivered!)

![Routing Visualization Complete](./.playwright-mcp/routing-visualization-complete-view.png)

### Cost Breakdown

**Total Cost: 300 msat (~$0.03 USD)**

Distributed as:

- **Facilitator:** 50 msat (gateway fee)
- **Connector1:** 100 msat (routing fee)
- **Connector2:** 100 msat (routing fee)
- **Bob:** 50 msat (delivery fee)

**Delivery Metrics:**

- **Delivery Time:** 4.2 seconds (including privacy delays)
- **Privacy Level:** 🔒 High (ephemeral keys, randomized timestamps)
- **Delivery Proof:** ✅ ILP Fulfill (cryptographic proof)

---

## Minute 4: Encryption Inspector (60 seconds)

### Open Encryption Inspector Panel

Click **"Show Details"** to expand the **Encryption Inspector** panel.

![Encryption Inspector Collapsed](./.playwright-mcp/encryption-inspector-collapsed.png)

This shows the **3 NIP-59 layers** used to encrypt your message:

![Encryption Inspector Expanded](./.playwright-mcp/encryption-inspector-expanded.png)

### Layer 3: Gift Wrap (Outermost Layer - Privacy)

```json
{
  "kind": 1059,
  "pubkey": "7f8e2d..." (EPHEMERAL - not Alice's real key),
  "created_at": 1738468234 (RANDOMIZED ±2 days),
  "content": "AbCdEf...encrypted_blob...",
  "sig": "9a3f1b..."
}
```

**Purpose:** Hide sender identity from connectors

- **Ephemeral pubkey** - Generated just for this message, then discarded
- **Randomized timestamp** - Hides when message was actually sent
- **Encrypted content** - Contains the seal (Layer 2)

### Layer 2: Seal (Middle Layer - Authentication)

```json
{
  "kind": 13,
  "pubkey": "a1b2c3..." (Alice's REAL pubkey),
  "created_at": 1738467890,
  "content": "XyZ123...encrypted_rumor...",
  "sig": "4d5e6f..." (Alice's signature)
}
```

**Purpose:** Prove message is from Alice (to Bob only)

- **Alice's real pubkey** - Only Bob can see this after decrypting giftwrap
- **Alice's signature** - Cryptographic proof message is from Alice
- **Encrypted content** - Contains the rumor (Layer 1)

### Layer 1: Rumor (Innermost Layer - Message)

```json
{
  "kind": 1,
  "pubkey": "a1b2c3..." (Alice's pubkey),
  "created_at": 1738467890,
  "content": "Hey Bob, confidential project update - we're shipping Epic 32!",
  "tags": [],
  "sig": null (UNSIGNED - deniability)
}
```

**Purpose:** The actual plaintext message

- **No signature** - Provides deniability (Bob can't prove to others Alice sent it)
- **Plaintext content** - Only visible after full unwrapping

### "What Connectors See" Section

**Connectors (Facilitator, C1, C2) can see:**

- ✅ **Destination:** `g.agent.bob.private` (routing information)
- ✅ **Payment:** 300 msat (ILP amount)
- ✅ **Encrypted blob:** 748 bytes (TOON-encoded giftwrap)
- ❌ **Message content** (strikethrough - encrypted!)
- ❌ **Real sender** (strikethrough - ephemeral key!)

**Privacy Guarantee:**

> "Connectors can route your message and collect payment, but they CANNOT read the content or identify the real sender."

---

## Minute 5: Delivery Confirmation (60 seconds)

### Switch to Bob's View

Open a **second browser tab**:

**http://localhost:5174/messenger?user=bob**

This is the same UI, but with different `localStorage` (Bob's private key).

### Bob's Perspective

**Bob sees:**

1. **Incoming message notification** (if WebSocket connected)
2. **Message bubble** in chat history:

   ```
   [Alice] Hey Bob, confidential project update - we're shipping Epic 32!
   ```

3. **Sender identified** - Bob knows it's from Alice (seal pubkey)
4. **Cannot prove to others** - Rumor is unsigned (deniability)

### Cryptographic Proof vs. Social Proof

**What Bob Has:**

- ✅ Cryptographic proof of **delivery** (ILP Fulfill)
- ✅ Cryptographic proof of **sender identity** (seal signature)
- ❌ Social proof to show others (rumor is unsigned)

**Deniability:**

> "Bob knows the message is from Alice, but he cannot prove it to a third party because the rumor layer is unsigned. This provides plausible deniability."

### Check Settlement on Blockchain

After **10 messages** (threshold: 1000 msat):

1. **Automatic settlement** triggered
2. **Balance proof exchange** (Epic 30):
   - Facilitator sends Kind 30001-30003 events via BTP
   - Connector1 verifies proofs
   - Settlement executes on Aptos testnet
3. **Blockchain confirmation** (wait 30 seconds)

**View Settlement Transaction:**

Open Aptos testnet explorer:

```
https://explorer.aptoslabs.com/txn/0x[transaction_hash]?network=testnet
```

(Transaction hash displayed in Facilitator logs after settlement)

**Settlement Details:**

- **Facilitator balance:** 500 msat → 0 (settled to Connector1)
- **Connector1 balance:** 1000 msat → 0 (settled to Connector2)
- **Aptos smart contract:** Payment channel state updated

---

## Wrap-Up

### What You Just Demonstrated

✅ **End-to-end encrypted messaging** with NIP-59 giftwrap (3 layers)
✅ **Privacy-preserving routing** with ephemeral keys and randomized timestamps
✅ **Multi-hop ILP payments** with cryptographic delivery proofs
✅ **Automatic settlement** on Aptos testnet blockchain
✅ **Real-time routing visualization** with cost breakdown
✅ **Client-side encryption** with browser-only private keys

### Key Takeaway

> "Complete privacy-preserving messaging system where connectors can route payments and messages WITHOUT seeing the plaintext content or identifying the real sender. All encryption happens client-side in the browser."

---

## Troubleshooting

### Problem: "Gateway connection refused" error

**Cause:** Messaging gateway not started or port conflict

**Solution:**

1. Check `docker-compose ps` - all containers should be healthy
2. Ensure port 3002 is free: `lsof -i :3002`
3. Restart facilitator service: `docker compose -f docker-compose-messaging-demo.yml restart facilitator`
4. Check logs: `docker compose -f docker-compose-messaging-demo.yml logs facilitator`

---

### Problem: "Private key not found" in browser

**Cause:** localStorage cleared or first-time user

**Solution:**

1. Click **"Generate New Key"** button in Key Manager
2. Private key generated and saved to browser `localStorage`
3. Public key (npub) displayed automatically
4. **Important:** Private key is browser-specific (not synced across devices)

---

### Problem: "Message not delivered" timeout

**Cause:** WebSocket disconnected or routing table misconfigured

**Solution:**

1. **Check WebSocket status** (should be 🟢 Online)
   - Red badge (🔴 Offline) means WebSocket disconnected
2. **Verify routing table** includes `g.agent.bob.private`:
   ```bash
   docker compose -f docker-compose-messaging-demo.yml logs facilitator | grep "routing table"
   ```
3. **Reconnect WebSocket:**
   - Refresh browser tab
   - Wait 5 seconds for automatic reconnection
4. **Check Bob Agent health:**
   ```bash
   curl http://localhost:8203/health
   ```

---

### Problem: "Settlement not visible on blockchain"

**Cause:** Settlement threshold not reached or blockchain confirmation delay

**Solution:**

1. **Check threshold reached:**
   - Send 4+ messages (4 × 300 = 1200 msat > 1000 msat threshold)
2. **Wait for confirmation:**
   - Aptos testnet confirmation takes 10-30 seconds
   - Check Facilitator logs for settlement transaction hash
3. **Refresh Aptos explorer:**
   - Wait 30 seconds after settlement trigger
   - Refresh explorer page
   - Transaction should appear in recent transactions
4. **Verify settlement config:**
   ```bash
   cat examples/messaging-gateway-config.yaml | grep -A3 "settlement:"
   ```

---

### Problem: "Encryption failed" error

**Cause:** Invalid recipient pubkey or nostr-tools version mismatch

**Solution:**

1. **Verify recipient pubkey format:**
   - Must be 64-character hex string (NOT npub format)
   - Example: `a1b2c3d4e5f6...` (64 chars)
2. **Check nostr-tools version:**

   ```bash
   npm list nostr-tools
   ```

   - Should be `2.20.0` (fixes critical `verifyEvent()` bug)

3. **Regenerate keypair:**
   - Click "Generate New Key" to create fresh keypair
   - Re-add contact with correct pubkey format

---

### Problem: Integration tests fail with "Container unhealthy"

**Cause:** Docker resource limits or port conflicts

**Solution:**

1. **Increase Docker memory:**
   - Docker Desktop → Settings → Resources
   - Memory: Minimum 4GB (8GB recommended)
   - CPUs: Minimum 2 cores
2. **Check port conflicts:**

   ```bash
   lsof -i :3000-3012,8545
   ```

   - Kill conflicting processes or change ports in docker-compose

3. **Restart Docker Desktop:**
   - Quit Docker Desktop
   - Clear caches: `rm -rf ~/Library/Containers/com.docker.docker/Data`
   - Restart Docker Desktop
4. **Check logs for specific errors:**
   ```bash
   docker compose -f docker-compose-messaging-demo.yml logs --tail=100
   ```

---

## FAQ

### Q: Where are private keys stored?

**A:** Browser `localStorage` only, never sent to server

Private keys are generated client-side using `generateSecretKey()` from `nostr-tools` and stored in browser `localStorage`. They are **never transmitted** to the server or any third party. Each browser (or browser profile) has its own private key.

**Security Notes:**

- Private key: 32 bytes of cryptographic entropy
- Storage: `localStorage.setItem('nostr-privkey', hex)`
- Access: Only the same origin (http://localhost:5173) can read it
- Lifetime: Persists until browser cache cleared

---

### Q: Can connectors read my messages?

**A:** No, messages are encrypted client-side with NIP-59

Connectors (Facilitator, Connector1, Connector2) only see:

- **Encrypted blob** (748 bytes of ciphertext)
- **Ephemeral pubkey** (NOT your real pubkey)
- **Randomized timestamp** (±2 days from actual time)
- **Destination ILP address** (`g.agent.bob.private`)
- **Payment amount** (300 msat)

They **cannot** see:

- ❌ Plaintext message content
- ❌ Real sender identity (your actual pubkey)
- ❌ Actual send time (timestamp randomized)

**Why?** Client-side encryption with 3 NIP-59 layers ensures privacy.

---

### Q: How much does it cost to send a message?

**A:** 300 msat (~$0.03 USD) distributed across 4 parties

**Cost Breakdown:**

- **Facilitator:** 50 msat (gateway fee)
- **Connector1:** 100 msat (routing fee - first hop)
- **Connector2:** 100 msat (routing fee - second hop)
- **Bob:** 50 msat (delivery fee)

**Total:** 300 millisatoshis (msat)

**USD Equivalent:** ~$0.03 (at $100,000/BTC)

**Why so cheap?** Lightning Network micropayments enable sub-cent transactions.

---

### Q: What happens if Bob is offline?

**A:** Gateway queues message, delivers when Bob reconnects

**Message Queuing:**

- If Bob's WebSocket is **disconnected**, the gateway queues the message
- Queue stored in facilitator's in-memory buffer
- **Max queue size:** 1000 messages per recipient
- **Message TTL:** 24 hours (expires if not delivered)

**Delivery on Reconnect:**

- Bob reconnects WebSocket → Gateway detects connection
- Gateway pushes all queued messages (FIFO order)
- Messages delivered within 2 seconds of reconnection

**Alice's Perspective:**

- Still receives **ILP Fulfill** (delivery confirmed to gateway)
- Badge shows ✅ **Delivered** (to gateway, queued for Bob)

---

## Performance Benchmarks

See full benchmark report: [docs/qa/benchmarks/32.6-private-messaging-performance.md](../qa/benchmarks/32.6-private-messaging-performance.md)

### Latency (p50, p95, p99)

- **p50 (median):** 2.8 seconds
- **p95:** 4.6 seconds
- **p99:** 7.2 seconds
- **Target:** <5 seconds (p95) ✅ PASS

### Throughput

- **Single user:** 12 messages/minute
- **Concurrent (10 users):** 8 messages/minute per user
- **Target:** >10 messages/minute ✅ PASS

### Encryption Performance

- **Giftwrap creation:** 42ms per message (rumor → seal → giftwrap)
- **Target:** <50ms ✅ PASS

### TOON Encoding Efficiency

- **JSON size:** 1247 bytes
- **TOON size:** 792 bytes
- **Compression ratio:** 36.5%
- **Target:** >35% ✅ PASS

---

## Additional Resources

- **Epic 32 PRD:** `docs/prd/epic-32-private-messaging-nip59-giftwrap-routing.md`
- **NIP-59 Spec:** https://github.com/nostr-protocol/nips/blob/master/59.md
- **NIP-44 Encryption:** https://github.com/nostr-protocol/nips/blob/master/44.md
- **ILP RFC-0027:** `docs/rfcs/rfc-0027-ilpv4.md`
- **Aptos Testnet:** https://explorer.aptoslabs.com/?network=testnet
