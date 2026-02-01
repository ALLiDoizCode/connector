/**
 * Integration tests for Workflow Peer Server
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 * Task 9: Add Integration Test for Workflow Execution
 */

import { WorkflowPeerServer } from '../../src/workflow/workflow-peer-server';
import type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@m2m/shared';
import { PacketType } from '@m2m/shared';
import sharp from 'sharp';
import pino from 'pino';

describe('WorkflowPeerServer Integration Tests', () => {
  let server: WorkflowPeerServer;
  let logger: pino.Logger;
  let testImageBuffer: Buffer;

  beforeAll(async () => {
    // Create test logger
    logger = pino({ level: 'silent' }); // Silent for tests

    // Create test image (2048x1536 blue JPEG)
    testImageBuffer = await sharp({
      create: {
        width: 2048,
        height: 1536,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    // Create server with test ports
    server = new WorkflowPeerServer(
      {
        httpPort: 8888,
        btpPort: 4444,
      },
      logger
    );

    await server.start();
  });

  describe('Full Workflow Execution', () => {
    it('should execute full resize→watermark→optimize pipeline', async () => {
      // Arrange - Create ILP Prepare packet
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n, // 100 + 200 + 150 = 450 msat
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer, // Raw image bytes
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Fulfill
      expect(response).toHaveProperty('fulfillment');
      expect((response as ILPFulfillPacket).fulfillment).toEqual(
        WorkflowPeerServer.AGENT_FULFILLMENT
      );

      // Decode processed image
      const processedImageBase64 = (response as ILPFulfillPacket).data.toString('utf8');
      const processedImage = Buffer.from(processedImageBase64, 'base64');

      // Verify image was processed (dimensions changed from resize)
      const metadata = await sharp(processedImage).metadata();
      expect(metadata.width).toBe(1024); // Default resize width
      expect(metadata.height).toBe(768); // Default resize height
    });

    it('should execute single step workflow (resize only)', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 100n, // Resize cost only
        destination: 'g.workflow.resize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert
      expect(response).toHaveProperty('fulfillment');

      // Decode and verify
      const processedImageBase64 = (response as ILPFulfillPacket).data.toString('utf8');
      const processedImage = Buffer.from(processedImageBase64, 'base64');
      const metadata = await sharp(processedImage).metadata();
      expect(metadata.width).toBe(1024);
    });

    it('should execute two-step workflow (resize→watermark)', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 300n, // 100 + 200 = 300 msat
        destination: 'g.workflow.resize.watermark',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert
      expect(response).toHaveProperty('fulfillment');

      // Verify processing
      const processedImageBase64 = (response as ILPFulfillPacket).data.toString('utf8');
      const processedImage = Buffer.from(processedImageBase64, 'base64');
      expect(processedImage.length).toBeGreaterThan(0);
    });
  });

  describe('Payment Validation', () => {
    it('should reject packet with insufficient payment', async () => {
      // Arrange - Send only 100 msat but need 450 for full pipeline
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 100n,
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with T04 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('T04');
      expect((response as ILPRejectPacket).message).toContain('Required 450');
    });

    it('should accept packet with exact required payment', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n, // Exact amount
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be Fulfill
      expect(response).toHaveProperty('fulfillment');
    });

    it('should accept packet with overpayment', async () => {
      // Arrange - Pay more than required
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 1000n, // Overpayment
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be Fulfill
      expect(response).toHaveProperty('fulfillment');
    });
  });

  describe('Error Handling', () => {
    it('should reject packet with invalid image data', async () => {
      // Arrange - Send non-image data
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: Buffer.from('This is not an image'),
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with T00 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('T00');
      expect((response as ILPRejectPacket).message).toContain('Invalid image');
    });

    it('should reject packet with oversized image (>10MB)', async () => {
      // Arrange - Create 11MB buffer
      const oversizedImage = Buffer.alloc(11 * 1024 * 1024);
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: oversizedImage,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with T00 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('T00');
      expect((response as ILPRejectPacket).message).toContain('maximum size');
    });

    it('should reject packet with non-workflow address', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.connector.alice', // Not a workflow address
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with F02 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('F02');
      expect((response as ILPRejectPacket).message).toContain('unreachable');
    });

    it('should reject packet with invalid workflow step', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.workflow.invalid.step', // Invalid step name
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: testImageBuffer,
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with T00 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('T00');
    });

    it('should reject packet with empty data', async () => {
      // Arrange
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.workflow.resize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: Buffer.alloc(0), // Empty buffer
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be ILP Reject with T00 code
      expect(response).toHaveProperty('code');
      expect((response as ILPRejectPacket).code).toBe('T00');
    });
  });

  describe('Base64 Encoding Support', () => {
    it('should handle base64-encoded image data in packet', async () => {
      // Arrange - Encode image as base64
      const base64Image = testImageBuffer.toString('base64');
      const packet: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: 450n,
        destination: 'g.workflow.resize.watermark.optimize',
        executionCondition: WorkflowPeerServer.AGENT_CONDITION,
        expiresAt: new Date(Date.now() + 30000),
        data: Buffer.from(base64Image, 'utf8'), // Base64 string as buffer
      };

      // Act
      const response = await server.handleILPPacket(packet);

      // Assert - Should be Fulfill
      expect(response).toHaveProperty('fulfillment');

      // Verify processed image
      const processedImageBase64 = (response as ILPFulfillPacket).data.toString('utf8');
      const processedImage = Buffer.from(processedImageBase64, 'base64');
      const metadata = await sharp(processedImage).metadata();
      expect(metadata.width).toBe(1024);
    });
  });
});
