import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import * as apiClient from './lib/api-client';
import { ProcessingError } from './lib/api-client';
import { createMockImageFile, createMockProcessedBlob } from './test/helpers/test-data-factories';

// Partial mock - keep ProcessingError class, mock processImage function
vi.mock('./lib/api-client', async () => {
  const actual = await vi.importActual('./lib/api-client');
  return {
    ...actual,
    processImage: vi.fn(),
  };
});

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-url');
global.URL.revokeObjectURL = vi.fn();

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload state initially', () => {
    render(<App />);

    expect(screen.getByText(/ILP Workflow Demo/i)).toBeInTheDocument();
    expect(screen.getByText(/drag and drop your image here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /process image/i })).toBeDisabled();
  });

  it('enables process button when file selected', async () => {
    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = createMockImageFile();

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process image/i })).not.toBeDisabled();
    });
  });

  it('transitions to processing state when processing image', async () => {
    const processImageMock = vi.spyOn(apiClient, 'processImage').mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep in processing state
    );

    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = createMockImageFile();

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process image/i })).not.toBeDisabled();
    });

    const processButton = screen.getByRole('button', { name: /process image/i });
    fireEvent.click(processButton);

    await waitFor(() => {
      expect(screen.getByText(/processing image/i)).toBeInTheDocument();
      expect(screen.getByText(/processing pipeline/i)).toBeInTheDocument();
    });

    processImageMock.mockRestore();
  });

  it('displays result after successful processing', async () => {
    const processedBlob = createMockProcessedBlob();
    vi.mocked(apiClient.processImage).mockResolvedValue(processedBlob);

    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = createMockImageFile();

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process image/i })).not.toBeDisabled();
    });

    const processButton = screen.getByRole('button', { name: /process image/i });
    fireEvent.click(processButton);

    await waitFor(() => {
      expect(screen.getByText(/processing complete/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });
  });

  it('displays error state when processing fails', async () => {
    const error = new ProcessingError('Test error message', 'TEST_ERROR', 500);
    vi.mocked(apiClient.processImage).mockRejectedValue(error);

    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = createMockImageFile();

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process image/i })).not.toBeDisabled();
    });

    const processButton = screen.getByRole('button', { name: /process image/i });
    fireEvent.click(processButton);

    await waitFor(
      () => {
        expect(screen.getByText(/processing failed/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    expect(screen.getByText(/test error message/i)).toBeInTheDocument();
  });

  it('resets workflow when start over clicked', async () => {
    const processedBlob = createMockProcessedBlob();
    vi.mocked(apiClient.processImage).mockResolvedValue(processedBlob);

    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = createMockImageFile();

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process image/i })).not.toBeDisabled();
    });

    const processButton = screen.getByRole('button', { name: /process image/i });
    fireEvent.click(processButton);

    await waitFor(() => {
      expect(screen.getByText(/processing complete/i)).toBeInTheDocument();
    });

    const resetButton = screen.getByRole('button', { name: /process another image/i });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(screen.getByText(/drag and drop your image here/i)).toBeInTheDocument();
    });
  });
});
