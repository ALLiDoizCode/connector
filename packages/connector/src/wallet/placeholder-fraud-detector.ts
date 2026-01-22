/**
 * Placeholder Fraud Detector
 * Story 11.9: Security Hardening for Agent Wallets
 *
 * Placeholder implementation for Epic 12 fraud detector integration.
 * Always returns "no fraud detected" for MVP.
 */

import type { FraudDetector, FraudCheckResult } from './fraud-detector-interface';

/**
 * Placeholder Fraud Detector
 * Always returns no fraud detected for MVP
 */
export class PlaceholderFraudDetector implements FraudDetector {
  /**
   * Analyze transaction for fraud
   * @returns Always returns { detected: false } for MVP
   * @remarks
   * Epic 12 will replace this with real fraud detection
   */
  async analyzeTransaction(_params: {
    agentId: string;
    amount: bigint;
    token: string;
    timestamp: number;
  }): Promise<FraudCheckResult> {
    // Always return no fraud detected for MVP
    return { detected: false };
  }
}
