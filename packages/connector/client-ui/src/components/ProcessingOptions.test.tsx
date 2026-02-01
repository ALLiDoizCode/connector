import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcessingOptions } from './ProcessingOptions';

describe('ProcessingOptions', () => {
  it('renders all processing steps with default state', () => {
    const onStepsChange = vi.fn();
    render(<ProcessingOptions onStepsChange={onStepsChange} />);

    expect(screen.getByLabelText(/resize/i)).toBeChecked();
    expect(screen.getByLabelText(/watermark/i)).toBeChecked();
    expect(screen.getByLabelText(/optimize/i)).toBeChecked();
  });

  it('displays correct total cost for all steps', () => {
    const onStepsChange = vi.fn();
    render(<ProcessingOptions onStepsChange={onStepsChange} />);

    expect(screen.getByText('450 msat')).toBeInTheDocument();
  });

  it('updates cost when steps are toggled', async () => {
    const onStepsChange = vi.fn();
    render(<ProcessingOptions onStepsChange={onStepsChange} />);

    const resizeCheckbox = screen.getByLabelText(/resize/i);
    fireEvent.click(resizeCheckbox);

    expect(screen.getByText('350 msat')).toBeInTheDocument();
  });

  it('calls onStepsChange with updated steps', async () => {
    const onStepsChange = vi.fn();
    render(<ProcessingOptions onStepsChange={onStepsChange} />);

    const resizeCheckbox = screen.getByLabelText(/resize/i);
    fireEvent.click(resizeCheckbox);

    expect(onStepsChange).toHaveBeenCalledWith(expect.arrayContaining(['watermark', 'optimize']));
    expect(onStepsChange).toHaveBeenCalledWith(expect.not.arrayContaining(['resize']));
  });

  it('displays individual step costs', () => {
    const onStepsChange = vi.fn();
    render(<ProcessingOptions onStepsChange={onStepsChange} />);

    expect(screen.getByText('100 msat')).toBeInTheDocument();
    expect(screen.getByText('200 msat')).toBeInTheDocument();
    expect(screen.getByText('150 msat')).toBeInTheDocument();
  });
});
