/**
 * Database Schema for Agent Wallet Metadata
 * Story 11.2: Agent Wallet Derivation and Address Generation
 *
 * This schema stores persistent wallet metadata for AI agents.
 * Private keys are NEVER stored - only public addresses and metadata.
 */

export const AGENT_WALLETS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id TEXT PRIMARY KEY,           -- Unique agent identifier
  derivation_index INTEGER UNIQUE NOT NULL,  -- BIP-44 index (prevents collisions)
  evm_address TEXT NOT NULL,           -- Ethereum/Base L2 address
  xrp_address TEXT NOT NULL,           -- XRP Ledger address
  created_at INTEGER NOT NULL,         -- Unix timestamp
  metadata TEXT                        -- JSON-serialized optional metadata
);
`;

export const AGENT_WALLETS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_derivation_index ON agent_wallets(derivation_index);',
  'CREATE INDEX IF NOT EXISTS idx_evm_address ON agent_wallets(evm_address);',
  'CREATE INDEX IF NOT EXISTS idx_xrp_address ON agent_wallets(xrp_address);',
];

/**
 * Database Schema for Agent Balance History
 * Story 11.3: Agent Wallet Balance Tracking and Monitoring
 *
 * This schema stores historical balance snapshots for agent wallets.
 * Balance stored as TEXT to preserve full precision (SQLite INTEGER is 64-bit, insufficient for uint256).
 */
export const AGENT_BALANCES_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,              -- References agent_wallets.agent_id
  chain TEXT NOT NULL,                 -- 'evm' or 'xrp'
  token TEXT NOT NULL,                 -- Token identifier
  balance TEXT NOT NULL,               -- Balance as string (bigint serialized)
  timestamp INTEGER NOT NULL           -- Unix timestamp
);
`;

export const AGENT_BALANCES_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_agent_balances_lookup ON agent_balances(agent_id, chain, token);',
  'CREATE INDEX IF NOT EXISTS idx_agent_balances_timestamp ON agent_balances(timestamp);',
];
