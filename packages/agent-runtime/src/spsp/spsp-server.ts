/**
 * SPSP Server
 *
 * Implements Simple Payment Setup Protocol (SPSP) endpoints per RFC-0009.
 * Provides payment setup endpoints that return destination addresses and shared secrets.
 *
 * @see https://interledger.org/rfcs/0009-simple-payment-setup-protocol/
 */

import { Router, Request, Response } from 'express';
import { Logger } from 'pino';
import { SessionManager } from '../session/session-manager';
import { BusinessClient } from '../business/business-client';
import { SPSPResponse, PaymentSetupRequest } from '../types';

export interface SPSPServerConfig {
  /** Whether SPSP endpoints are enabled */
  enabled: boolean;
}

/**
 * SPSP endpoint handler.
 *
 * Provides endpoints for payment setup:
 * - GET /.well-known/pay/:paymentId?
 * - GET /pay/:paymentId?
 */
export class SPSPServer {
  private readonly config: SPSPServerConfig;
  private readonly sessionManager: SessionManager;
  private readonly businessClient: BusinessClient;
  private readonly logger: Logger;
  private readonly router: Router;

  constructor(
    config: SPSPServerConfig,
    sessionManager: SessionManager,
    businessClient: BusinessClient,
    logger: Logger
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.businessClient = businessClient;
    this.logger = logger.child({ component: 'SPSPServer' });
    this.router = Router();

    if (this.config.enabled) {
      this.setupRoutes();
    }
  }

  /**
   * Get the Express router for SPSP endpoints.
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Set up SPSP routes.
   */
  private setupRoutes(): void {
    // Standard SPSP well-known endpoint
    this.router.get('/.well-known/pay/:paymentId?', this.handleSPSPQuery.bind(this));
    this.router.get('/.well-known/pay', this.handleSPSPQuery.bind(this));

    // Alternative SPSP endpoint
    this.router.get('/pay/:paymentId?', this.handleSPSPQuery.bind(this));
    this.router.get('/pay', this.handleSPSPQuery.bind(this));
  }

  /**
   * Handle SPSP query request.
   *
   * Flow:
   * 1. Check Accept header for application/spsp4+json
   * 2. Call optional payment setup hook
   * 3. Create payment session
   * 4. Return SPSP response
   */
  private async handleSPSPQuery(req: Request, res: Response): Promise<void> {
    const paymentId = req.params['paymentId'];
    const queryParams = req.query as Record<string, string>;

    this.logger.debug({ paymentId, queryParams }, 'SPSP query received');

    // Check Accept header (should be application/spsp4+json for SPSP4)
    const accept = req.get('Accept');
    if (
      accept &&
      !accept.includes('application/spsp4+json') &&
      !accept.includes('application/json') &&
      !accept.includes('*/*')
    ) {
      this.logger.debug({ accept }, 'Invalid Accept header for SPSP');
      res.status(406).json({ error: 'Accept header must include application/spsp4+json' });
      return;
    }

    // Call optional payment setup hook
    const setupRequest: PaymentSetupRequest = {
      paymentId,
      queryParams,
    };

    const setupResponse = await this.businessClient.paymentSetup(setupRequest);

    if (!setupResponse.allow) {
      this.logger.warn(
        { paymentId, errorMessage: setupResponse.errorMessage },
        'Payment setup rejected by business logic'
      );
      res.status(403).json({
        error: setupResponse.errorMessage ?? 'Payment setup not allowed',
      });
      return;
    }

    // Create payment session
    const session = this.sessionManager.createSession(
      setupResponse.metadata,
      setupResponse.paymentId ?? paymentId
    );

    // Build SPSP response
    const spspResponse: SPSPResponse = {
      destination_account: session.destinationAddress,
      shared_secret: session.sharedSecret.toString('base64'),
    };

    this.logger.info(
      { paymentId: session.paymentId, destination: session.destinationAddress },
      'SPSP response sent'
    );

    res.set('Content-Type', 'application/spsp4+json');
    res.json(spspResponse);
  }
}
