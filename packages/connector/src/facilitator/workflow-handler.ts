import { Request, Response } from 'express';
import pino from 'pino';
import crypto from 'crypto';
import { ServiceRegistry } from './service-registry';
import { SPSPClient, SPSPError } from './spsp-client';
import { BTPClient, BTPConnectionError } from '../btp/btp-client';
import { ILPPreparePacket, PacketType, ILPRejectPacket } from '@m2m/shared';

function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface WorkflowMetadata {
  requestId: string;
  steps: string[];
  timestamp: number;
}

function createWorkflowPacket(
  destination: string,
  amount: bigint,
  imageBuffer: Buffer,
  metadata: WorkflowMetadata
): ILPPreparePacket {
  // Encode image and metadata
  const imageBase64 = imageBuffer.toString('base64');
  const payloadData = JSON.stringify({
    image: imageBase64,
    ...metadata,
  });

  // Generate random 32-byte execution condition
  const executionCondition = crypto.randomBytes(32);

  // Set expiration to 30 seconds from now
  const expiresAt = new Date(Date.now() + 30000);

  return {
    type: PacketType.PREPARE,
    amount,
    destination,
    executionCondition,
    expiresAt,
    data: Buffer.from(payloadData, 'utf-8'),
  };
}

export async function handleWorkflowRequest(
  req: Request,
  res: Response,
  serviceRegistry: ServiceRegistry,
  spspClient: SPSPClient,
  btpClient: BTPClient,
  logger: pino.Logger,
  maxImageSize: number,
  acceptedFormats: string[]
): Promise<Response | void> {
  const requestId = generateRequestId();
  logger.info({ requestId }, 'Workflow request received');

  try {
    // Extract image file from multipart form data
    const imageFile = req.file;
    if (!imageFile) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Validate file size
    if (imageFile.size > maxImageSize) {
      return res.status(400).json({
        error: 'Image too large',
        message: `Maximum size is ${maxImageSize / 1024 / 1024}MB`,
        code: 'IMAGE_TOO_LARGE',
      });
    }

    // Validate MIME type
    if (!acceptedFormats.includes(imageFile.mimetype)) {
      return res.status(400).json({
        error: 'Invalid image format',
        message: `Supported formats: ${acceptedFormats.join(', ')}`,
        code: 'INVALID_FORMAT',
      });
    }

    // Parse processing options from form data
    const stepsInput = req.body.steps || '["resize", "watermark", "optimize"]';
    let steps: string[];
    try {
      steps = JSON.parse(stepsInput);
      if (!Array.isArray(steps)) {
        throw new Error('Steps must be an array');
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid steps format',
        message: 'Steps must be a valid JSON array',
        code: 'INVALID_STEPS',
      });
    }

    // Get workflow service from registry
    const service = serviceRegistry.getService('default');
    if (!service || service.status === 'unavailable') {
      return res.status(503).json({
        error: 'Workflow service unavailable',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    // Perform SPSP handshake to get ILP address
    let spspResponse;
    try {
      spspResponse = await spspClient.resolvePaymentPointer(service.paymentPointer);
    } catch (error) {
      if (error instanceof SPSPError) {
        if (error.code === 'PEER_UNREACHABLE') {
          return res.status(503).json({
            error: 'Workflow peer unreachable',
            message: 'DNS lookup failed',
            code: 'PEER_UNREACHABLE',
          });
        }
        if (error.statusCode === 404) {
          return res.status(503).json({
            error: 'Invalid payment pointer',
            message: 'SPSP endpoint not found',
            code: 'INVALID_PAYMENT_POINTER',
          });
        }
      }
      throw error;
    }

    // Calculate total cost
    const totalCost = steps.reduce(
      (sum, step) => sum + BigInt(service.capabilities.pricing[step] || 0),
      0n
    );

    // Construct ILP Prepare packet
    const ilpPacket = createWorkflowPacket(
      spspResponse.destination_account,
      totalCost,
      imageFile.buffer,
      { requestId, steps, timestamp: Date.now() }
    );

    // Send ILP packet to Connector1 via BTP
    let responsePacket;
    try {
      responsePacket = await btpClient.sendPacket(ilpPacket);
    } catch (error) {
      if (error instanceof BTPConnectionError) {
        return res.status(503).json({
          error: 'Connector unavailable',
          message: error.message,
          code: 'CONNECTOR_UNAVAILABLE',
        });
      }
      throw error;
    }

    // Check if response is ILP Reject
    if (responsePacket.type === PacketType.REJECT) {
      const rejectPacket = responsePacket as ILPRejectPacket;
      const httpStatus = rejectPacket.code.startsWith('T') ? 503 : 500;
      return res.status(httpStatus).json({
        error: 'Workflow execution failed',
        message: rejectPacket.message,
        code: `ILP_${rejectPacket.code}`,
      });
    }

    // Extract processed image from fulfillment data
    const fulfillData = responsePacket.data.toString('utf-8');
    let processedImage: Buffer;
    try {
      const payload = JSON.parse(fulfillData);
      if (payload.image) {
        processedImage = Buffer.from(payload.image, 'base64');
      } else {
        // Fallback: assume the entire data field is base64-encoded image
        processedImage = Buffer.from(fulfillData, 'base64');
      }
    } catch (error) {
      // If JSON parsing fails, treat data as base64 image
      processedImage = Buffer.from(fulfillData, 'base64');
    }

    // Return processed image
    res.set('Content-Type', imageFile.mimetype);
    res.set('Content-Disposition', `attachment; filename="processed-${imageFile.originalname}"`);
    res.status(200).send(processedImage);

    logger.info(
      {
        requestId,
        totalCost: totalCost.toString(),
        steps: steps.length,
      },
      'Workflow completed'
    );
  } catch (error) {
    logger.error({ requestId, err: error }, 'Workflow failed');

    if (error instanceof SPSPError) {
      return res.status(503).json({
        error: 'Workflow peer unreachable',
        code: 'PEER_ERROR',
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    });
  }
}
