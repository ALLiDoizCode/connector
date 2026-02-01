import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageUploader } from './ImageUploader';
import { createMockImageFile } from '../test/helpers/test-data-factories';

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-url');
global.URL.revokeObjectURL = vi.fn();

describe('ImageUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload prompt when no image selected', () => {
    const onFileSelect = vi.fn();
    render(<ImageUploader onFileSelect={onFileSelect} />);

    expect(screen.getByText(/drag and drop your image here/i)).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG, or WebP/i)).toBeInTheDocument();
  });

  it('calls onFileSelect with valid file', async () => {
    const onFileSelect = vi.fn();
    const validFile = createMockImageFile();

    render(<ImageUploader onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', {
      value: [validFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(() => {
      expect(onFileSelect).toHaveBeenCalledWith(validFile);
    });
  });

  it('shows error for oversized file', async () => {
    const onFileSelect = vi.fn();
    const oversizedFile = createMockImageFile({ size: 11 * 1024 * 1024 }); // 11MB

    render(<ImageUploader onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', {
      value: [oversizedFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(
      () => {
        const errorElement = screen.queryByText(/too large/i);
        expect(errorElement).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    expect(onFileSelect).not.toHaveBeenCalled();
    expect(global.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('shows error for invalid format', async () => {
    const onFileSelect = vi.fn();
    const invalidFile = createMockImageFile({ type: 'image/gif', name: 'test.gif' });

    render(<ImageUploader onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', {
      value: [invalidFile],
      writable: false,
    });

    fireEvent.change(input);

    await waitFor(
      () => {
        expect(screen.getByText(/unsupported format/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('handles drag and drop', async () => {
    const onFileSelect = vi.fn();
    const validFile = createMockImageFile();

    render(<ImageUploader onFileSelect={onFileSelect} />);

    const dropZone = screen.getByText(/drag and drop your image here/i).closest('div')!;

    const dropEvent = new Event('drop', { bubbles: true }) as DragEvent & {
      dataTransfer: { files: File[] };
    };
    dropEvent.dataTransfer = {
      files: [validFile],
    };

    fireEvent(dropZone, dropEvent);

    await waitFor(() => {
      expect(onFileSelect).toHaveBeenCalledWith(validFile);
    });
  });
});
