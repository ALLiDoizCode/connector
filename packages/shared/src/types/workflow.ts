/**
 * Workflow processing type definitions
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 */

/**
 * Represents a single processing step in a workflow pipeline.
 */
export interface WorkflowStep {
  /** Step name (resize, watermark, optimize) */
  stepName: 'resize' | 'watermark' | 'optimize';
  /** Cost in millisatoshis for this step */
  costMsat: number;
}

/**
 * Parameters for resize operation.
 */
export interface ResizeParams {
  /** Target width in pixels */
  width: number;
  /** Target height in pixels */
  height: number;
  /** Resize fit mode */
  fit: 'cover' | 'contain' | 'fill';
}

/**
 * Parameters for watermark operation.
 */
export interface WatermarkParams {
  /** Watermark text to overlay */
  text: string;
  /** Position of watermark on image */
  position: 'bottom-right' | 'bottom-left' | 'center';
  /** Opacity of watermark (0.0 to 1.0) */
  opacity: number;
}

/**
 * Parameters for optimize operation.
 */
export interface OptimizeParams {
  /** Image quality (1-100) */
  quality: number;
  /** Output image format */
  format: 'jpeg' | 'png' | 'webp';
}

/**
 * Result of a single completed workflow step.
 */
export interface CompletedStep {
  /** Name of the step that was executed */
  stepName: string;
  /** Duration of step execution in milliseconds */
  duration: number;
  /** Whether the step succeeded */
  success: boolean;
  /** Error message if step failed */
  error?: string;
}

/**
 * Result of executing a workflow pipeline.
 */
export interface WorkflowResult {
  /** Processed image buffer */
  processedImage: Buffer;
  /** List of completed steps with execution metadata */
  steps: CompletedStep[];
  /** Total duration of all steps in milliseconds */
  totalDuration: number;
}
