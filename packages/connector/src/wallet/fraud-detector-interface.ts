/**
 * Fraud Detector Interface
 * Story 11.9: Security Hardening for Agent Wallets
 *
 * Interface for Epic 12 fraud detection integration
 */

/**
 * Fraud check result
 */
export interface FraudCheckResult {
  detected: boolean; // True if fraud detected
  reason?: string; // Human-readable fraud detection reason
  score?: number; // Fraud score (0-100, higher = more suspicious)
}

/**
 * Fraud detector interface (Epic 12 integration)
 */
export interface FraudDetector {
  analyzeTransaction(params: {
    agentId: string;
    amount: bigint;
    token: string;
    timestamp: number;
  }): Promise<FraudCheckResult>;
}
