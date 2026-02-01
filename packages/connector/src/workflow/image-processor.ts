/**
 * Image processing with Sharp library
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 * Task 3: Implement Image Processor with Sharp
 */

import sharp from 'sharp';
import type { ResizeParams, WatermarkParams, OptimizeParams } from '@m2m/shared';

/**
 * Maximum image size in bytes (10MB)
 */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Image processor for workflow operations using Sharp library.
 */
export class ImageProcessor {
  /**
   * Validate image buffer before processing.
   * @param imageBuffer - Image buffer to validate
   * @throws Error if image is invalid or too large
   */
  private async validateImage(imageBuffer: Buffer): Promise<void> {
    // Check size
    if (imageBuffer.length === 0) {
      throw new Error('Image buffer is empty');
    }

    if (imageBuffer.length > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image size ${imageBuffer.length} bytes exceeds maximum ${MAX_IMAGE_SIZE} bytes`
      );
    }

    // Validate format using Sharp metadata
    try {
      const metadata = await sharp(imageBuffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image: missing dimensions');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Input buffer')) {
        throw new Error('Invalid image format');
      }
      throw error;
    }
  }

  /**
   * Resize image to specified dimensions.
   * @param imageBuffer - Input image buffer
   * @param params - Resize parameters
   * @returns Resized image buffer
   */
  async resize(imageBuffer: Buffer, params: ResizeParams): Promise<Buffer> {
    await this.validateImage(imageBuffer);

    return sharp(imageBuffer).resize(params.width, params.height, { fit: params.fit }).toBuffer();
  }

  /**
   * Add watermark text overlay to image.
   * @param imageBuffer - Input image buffer
   * @param params - Watermark parameters
   * @returns Image buffer with watermark
   */
  async watermark(imageBuffer: Buffer, params: WatermarkParams): Promise<Buffer> {
    await this.validateImage(imageBuffer);

    // Get image metadata for positioning
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 768;

    // Calculate position based on params
    let x = 0;
    let y = 0;
    if (params.position === 'bottom-right') {
      x = Math.floor(width * 0.7);
      y = Math.floor(height * 0.9);
    } else if (params.position === 'bottom-left') {
      x = Math.floor(width * 0.05);
      y = Math.floor(height * 0.9);
    } else if (params.position === 'center') {
      x = Math.floor(width * 0.5);
      y = Math.floor(height * 0.5);
    }

    // Create SVG watermark
    const svg = `
      <svg width="${width}" height="${height}">
        <text
          x="${x}"
          y="${y}"
          font-family="Arial"
          font-size="24"
          fill="white"
          fill-opacity="${params.opacity}"
          text-anchor="middle"
        >${params.text}</text>
      </svg>
    `;

    const svgBuffer = Buffer.from(svg);

    return sharp(imageBuffer)
      .composite([{ input: svgBuffer, top: 0, left: 0 }])
      .toBuffer();
  }

  /**
   * Optimize and compress image.
   * @param imageBuffer - Input image buffer
   * @param params - Optimize parameters
   * @returns Optimized image buffer
   */
  async optimize(imageBuffer: Buffer, params: OptimizeParams): Promise<Buffer> {
    await this.validateImage(imageBuffer);

    const processor = sharp(imageBuffer);

    // Apply format conversion and quality settings
    if (params.format === 'jpeg') {
      return processor.jpeg({ quality: params.quality }).toBuffer();
    } else if (params.format === 'png') {
      return processor.png({ quality: params.quality }).toBuffer();
    } else if (params.format === 'webp') {
      return processor.webp({ quality: params.quality }).toBuffer();
    }

    throw new Error(`Unsupported format: ${params.format}`);
  }
}
