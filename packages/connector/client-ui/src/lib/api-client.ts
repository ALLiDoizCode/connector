interface ProcessImageRequest {
  imageFile: File;
  steps: string[];
}

interface APIError {
  error: string;
  message: string;
  code?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  IMAGE_TOO_LARGE: 'Your image is too large. Maximum size is 10MB.',
  INVALID_FORMAT: 'Unsupported format. Please use PNG, JPEG, or WebP.',
  PEER_UNREACHABLE: 'Service temporarily unavailable. Please try again.',
  INVALID_PAYMENT_POINTER: 'Service configuration error. Please contact support.',
  TIMEOUT: 'Request timed out. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  DEFAULT: 'An error occurred. Please try again.',
};

export class ProcessingError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export async function processImage(request: ProcessImageRequest): Promise<Blob> {
  const formData = new FormData();
  formData.append('image', request.imageFile);
  formData.append('steps', JSON.stringify(request.steps));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('/api/workflow/process', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let errorData: APIError;
      try {
        errorData = await response.json();
      } catch {
        throw new ProcessingError(
          ERROR_MESSAGES.DEFAULT,
          'UNKNOWN_ERROR',
          response.status
        );
      }

      const userMessage = errorData.code && ERROR_MESSAGES[errorData.code]
        ? ERROR_MESSAGES[errorData.code]
        : ERROR_MESSAGES.DEFAULT;

      throw new ProcessingError(userMessage, errorData.code, response.status);
    }

    return await response.blob();
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof ProcessingError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProcessingError(ERROR_MESSAGES.TIMEOUT, 'TIMEOUT', 408);
    }

    throw new ProcessingError(ERROR_MESSAGES.NETWORK_ERROR, 'NETWORK_ERROR', 0);
  }
}
