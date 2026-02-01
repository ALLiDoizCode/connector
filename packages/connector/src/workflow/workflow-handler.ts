/**
 * Workflow address parsing and pipeline execution
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 * Task 4: Create Workflow Handler with Address Parsing
 */

import type {
  WorkflowStep,
  ResizeParams,
  WatermarkParams,
  OptimizeParams,
  WorkflowResult,
  CompletedStep,
} from '@m2m/shared';
import { ImageProcessor } from './image-processor';
import type { Logger } from 'pino';

/**
 * Step configuration with cost and default parameters.
 */
interface StepConfig {
  costMsat: number;
  defaultParams: ResizeParams | WatermarkParams | OptimizeParams;
}

/**
 * Step registry mapping step names to configuration.
 */
const STEP_REGISTRY: Record<string, StepConfig> = {
  resize: {
    costMsat: 100,
    defaultParams: {
      width: 1024,
      height: 768,
      fit: 'cover',
    } as ResizeParams,
  },
  watermark: {
    costMsat: 200,
    defaultParams: {
      text: 'Workflow ILP Demo',
      position: 'bottom-right',
      opacity: 0.7,
    } as WatermarkParams,
  },
  optimize: {
    costMsat: 150,
    defaultParams: {
      quality: 80,
      format: 'jpeg',
    } as OptimizeParams,
  },
};

/**
 * Workflow handler for parsing addresses and executing pipelines.
 */
export class WorkflowHandler {
  private readonly _imageProcessor: ImageProcessor;
  private readonly _logger?: Logger;

  constructor(logger?: Logger) {
    this._imageProcessor = new ImageProcessor();
    this._logger = logger;
  }

  /**
   * Parse workflow address to extract pipeline steps.
   * @param address - ILP address (e.g., g.workflow.resize.watermark.optimize)
   * @returns Array of workflow steps
   * @throws Error if address is not a workflow address
   */
  parseWorkflowAddress(address: string): WorkflowStep[] {
    const parts = address.split('.');

    // Validate workflow address format
    if (parts.length < 3 || parts[0] !== 'g' || parts[1] !== 'workflow') {
      throw new Error('Not a workflow address');
    }

    // Extract step names (everything after g.workflow.)
    const stepNames = parts.slice(2);

    if (stepNames.length === 0) {
      throw new Error('No workflow steps specified');
    }

    // Map step names to WorkflowStep objects
    const steps: WorkflowStep[] = stepNames.map((stepName) => {
      const config = STEP_REGISTRY[stepName];
      if (!config) {
        throw new Error(`Unknown workflow step: ${stepName}`);
      }

      return {
        stepName: stepName as 'resize' | 'watermark' | 'optimize',
        costMsat: config.costMsat,
      };
    });

    return steps;
  }

  /**
   * Calculate total cost for a workflow pipeline.
   * @param steps - Array of step names
   * @returns Total cost in millisatoshis
   */
  calculateWorkflowCost(steps: string[]): bigint {
    return steps.reduce((sum, stepName) => {
      const config = STEP_REGISTRY[stepName];
      return sum + BigInt(config?.costMsat || 0);
    }, 0n);
  }

  /**
   * Execute workflow pipeline sequentially.
   * @param steps - Array of workflow steps
   * @param imageBuffer - Input image buffer
   * @returns Workflow result with processed image and execution metadata
   */
  async executeWorkflow(steps: WorkflowStep[], imageBuffer: Buffer): Promise<WorkflowResult> {
    const completedSteps: CompletedStep[] = [];
    const startTime = Date.now();
    let currentImage = imageBuffer;

    for (const step of steps) {
      const stepStartTime = Date.now();
      let success = true;
      let error: string | undefined;

      try {
        // Get default params for the step
        const config = STEP_REGISTRY[step.stepName];
        if (!config) {
          throw new Error(`Unknown step: ${step.stepName}`);
        }
        const params = config.defaultParams;

        // Execute step based on type
        if (step.stepName === 'resize') {
          currentImage = await this._imageProcessor.resize(currentImage, params as ResizeParams);
        } else if (step.stepName === 'watermark') {
          currentImage = await this._imageProcessor.watermark(
            currentImage,
            params as WatermarkParams
          );
        } else if (step.stepName === 'optimize') {
          currentImage = await this._imageProcessor.optimize(
            currentImage,
            params as OptimizeParams
          );
        } else {
          throw new Error(`Unknown step type: ${step.stepName}`);
        }
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : 'Unknown error';
        this._logger?.error({ err, stepName: step.stepName }, 'Step execution failed');
        throw err; // Fail fast on errors
      } finally {
        const stepDuration = Date.now() - stepStartTime;
        completedSteps.push({
          stepName: step.stepName,
          duration: stepDuration,
          success,
          error,
        });

        this._logger?.info(
          {
            stepName: step.stepName,
            duration: stepDuration,
            success,
          },
          'Step completed'
        );
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      processedImage: currentImage,
      steps: completedSteps,
      totalDuration,
    };
  }
}
