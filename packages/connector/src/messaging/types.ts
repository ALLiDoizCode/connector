import { NostrEvent } from 'nostr-tools';

/** HTTP API request body for /api/route-giftwrap */
export interface RouteGiftwrapRequest {
  giftwrap: NostrEvent; // NIP-59 giftwrap event (kind 1059)
  recipient: string; // ILP address (e.g., "g.agent.bob.private")
  amount: number; // Payment amount in millisatoshis
}

/** HTTP API response for successful routing */
export interface RouteGiftwrapResponse {
  success: true;
  fulfill: string; // Base64-encoded ILP fulfillment (proves delivery)
  latency: number; // Milliseconds from request to fulfill
}

/** HTTP API error response */
export interface RouteGiftwrapErrorResponse {
  success?: false;
  error: string; // Error message
}

/** WebSocket message sent to client when giftwrap received */
export interface GiftwrapDeliveryMessage {
  type: 'giftwrap';
  data: NostrEvent; // Received giftwrap event
  amount: string; // Delivery payment amount (msat)
}

/** Configuration for MessagingGateway */
export interface MessagingGatewayConfig {
  httpPort: number; // HTTP server port (default: 3002)
  wsPort: number; // WebSocket server port (default: 3003)
  btpConnectionUrl: string; // BTP URL of first-hop connector
}
