import pino from 'pino';
import { SPSPClient } from './spsp-client';

export interface WorkflowCapabilities {
  maxImageSize: number;
  supportedFormats: string[];
  availableSteps: string[];
  pricing: { [step: string]: number };
}

export interface WorkflowService {
  id?: string;
  paymentPointer: string;
  capabilities: WorkflowCapabilities;
  lastHealthCheck: Date;
  status: 'available' | 'unavailable';
}

export class ServiceRegistry {
  private services = new Map<string, WorkflowService>();
  private logger: pino.Logger;
  private spspClient: SPSPClient;

  constructor(logger: pino.Logger, spspClient: SPSPClient) {
    this.logger = logger;
    this.spspClient = spspClient;
  }

  register(serviceId: string, service: WorkflowService): void {
    this.services.set(serviceId, {
      ...service,
      id: serviceId,
    });
    this.logger.info({ serviceId, paymentPointer: service.paymentPointer }, 'Service registered');
  }

  getService(serviceId: string): WorkflowService | null {
    return this.services.get(serviceId) || null;
  }

  getAllServices(): WorkflowService[] {
    return Array.from(this.services.values());
  }

  updateHealth(serviceId: string, status: 'available' | 'unavailable'): void {
    const service = this.services.get(serviceId);
    if (service) {
      service.status = status;
      service.lastHealthCheck = new Date();
      this.services.set(serviceId, service);
    }
  }

  async performHealthChecks(): Promise<void> {
    const services = Array.from(this.services.entries());

    for (const [serviceId, service] of services) {
      try {
        // Perform SPSP handshake to verify service is reachable
        await this.spspClient.resolvePaymentPointer(service.paymentPointer);
        this.updateHealth(serviceId, 'available');
        this.logger.debug({ serviceId }, 'Health check passed');
      } catch (error) {
        this.updateHealth(serviceId, 'unavailable');
        this.logger.warn({ serviceId, err: error }, 'Health check failed');
      }
    }
  }
}
