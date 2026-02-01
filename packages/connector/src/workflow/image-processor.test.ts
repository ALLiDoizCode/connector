/**
 * Unit tests for Image Processor
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 * Task 8: Add Unit Tests for Image Processor
 */

import { ImageProcessor } from './image-processor';
import sharp from 'sharp';

describe('ImageProcessor', () => {
  let processor: ImageProcessor;
  let testImageBuffer: Buffer;

  beforeAll(async () => {
    processor = new ImageProcessor();

    // Create test image programmatically (2048x1536 blue JPEG)
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

  describe('resize', () => {
    it('should resize image to target dimensions with cover fit', async () => {
      // Arrange
      const params = {
        width: 1024,
        height: 768,
        fit: 'cover' as const,
      };

      // Act
      const result = await processor.resize(testImageBuffer, params);

      // Assert
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBe(1024);
      expect(metadata.height).toBe(768);
    });

    it('should resize image to target dimensions with contain fit', async () => {
      // Arrange
      const params = {
        width: 512,
        height: 512,
        fit: 'contain' as const,
      };

      // Act
      const result = await processor.resize(testImageBuffer, params);

      // Assert
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBeLessThanOrEqual(512);
      expect(metadata.height).toBeLessThanOrEqual(512);
    });

    it('should throw error for empty buffer', async () => {
      // Arrange
      const emptyBuffer = Buffer.alloc(0);
      const params = {
        width: 1024,
        height: 768,
        fit: 'cover' as const,
      };

      // Act & Assert
      await expect(processor.resize(emptyBuffer, params)).rejects.toThrow('Image buffer is empty');
    });

    it('should throw error for oversized image (>10MB)', async () => {
      // Arrange
      const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const params = {
        width: 1024,
        height: 768,
        fit: 'cover' as const,
      };

      // Act & Assert
      await expect(processor.resize(oversizedBuffer, params)).rejects.toThrow('exceeds maximum');
    });

    it('should throw error for invalid image format (text file)', async () => {
      // Arrange
      const textBuffer = Buffer.from('This is not an image');
      const params = {
        width: 1024,
        height: 768,
        fit: 'cover' as const,
      };

      // Act & Assert
      await expect(processor.resize(textBuffer, params)).rejects.toThrow('Invalid image');
    });
  });

  describe('watermark', () => {
    it('should add watermark text to image at bottom-right', async () => {
      // Arrange
      const params = {
        text: 'Test Watermark',
        position: 'bottom-right' as const,
        opacity: 0.8,
      };

      // Act
      const result = await processor.watermark(testImageBuffer, params);

      // Assert
      expect(result.length).toBeGreaterThan(0);
      // Watermark should increase file size slightly (SVG overlay added)
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBe(2048);
      expect(metadata.height).toBe(1536);
    });

    it('should add watermark text to image at bottom-left', async () => {
      // Arrange
      const params = {
        text: 'Left Watermark',
        position: 'bottom-left' as const,
        opacity: 0.5,
      };

      // Act
      const result = await processor.watermark(testImageBuffer, params);

      // Assert
      expect(result.length).toBeGreaterThan(0);
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBe(2048);
    });

    it('should add watermark text to image at center', async () => {
      // Arrange
      const params = {
        text: 'Center Watermark',
        position: 'center' as const,
        opacity: 1.0,
      };

      // Act
      const result = await processor.watermark(testImageBuffer, params);

      // Assert
      expect(result.length).toBeGreaterThan(0);
    });

    it('should throw error for invalid image', async () => {
      // Arrange
      const invalidBuffer = Buffer.from('Not an image');
      const params = {
        text: 'Watermark',
        position: 'bottom-right' as const,
        opacity: 0.7,
      };

      // Act & Assert
      await expect(processor.watermark(invalidBuffer, params)).rejects.toThrow();
    });
  });

  describe('optimize', () => {
    it('should optimize image with JPEG quality compression', async () => {
      // Arrange
      const params = {
        quality: 80,
        format: 'jpeg' as const,
      };

      // Act
      const result = await processor.optimize(testImageBuffer, params);

      // Assert
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe('jpeg');
      // Optimized image should typically be smaller
      expect(result.length).toBeLessThanOrEqual(testImageBuffer.length);
    });

    it('should convert image to PNG format', async () => {
      // Arrange
      const params = {
        quality: 90,
        format: 'png' as const,
      };

      // Act
      const result = await processor.optimize(testImageBuffer, params);

      // Assert
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe('png');
    });

    it('should convert image to WebP format', async () => {
      // Arrange
      const params = {
        quality: 85,
        format: 'webp' as const,
      };

      // Act
      const result = await processor.optimize(testImageBuffer, params);

      // Assert
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe('webp');
    });

    it('should reduce file size with lower quality', async () => {
      // Arrange
      const highQualityParams = {
        quality: 100,
        format: 'jpeg' as const,
      };
      const lowQualityParams = {
        quality: 50,
        format: 'jpeg' as const,
      };

      // Act
      const highQualityResult = await processor.optimize(testImageBuffer, highQualityParams);
      const lowQualityResult = await processor.optimize(testImageBuffer, lowQualityParams);

      // Assert
      expect(lowQualityResult.length).toBeLessThan(highQualityResult.length);
    });

    it('should throw error for invalid image', async () => {
      // Arrange
      const invalidBuffer = Buffer.from('Not an image');
      const params = {
        quality: 80,
        format: 'jpeg' as const,
      };

      // Act & Assert
      await expect(processor.optimize(invalidBuffer, params)).rejects.toThrow();
    });

    it('should throw error for empty buffer', async () => {
      // Arrange
      const emptyBuffer = Buffer.alloc(0);
      const params = {
        quality: 80,
        format: 'jpeg' as const,
      };

      // Act & Assert
      await expect(processor.optimize(emptyBuffer, params)).rejects.toThrow(
        'Image buffer is empty'
      );
    });
  });
});
