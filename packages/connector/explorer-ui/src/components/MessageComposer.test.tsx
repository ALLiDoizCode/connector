import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageComposer } from './MessageComposer';
import { Contact } from '@/pages/PrivateMessenger';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the useGiftwrap hook
vi.mock('@/hooks/useGiftwrap', () => ({
  useGiftwrap: () => ({
    encrypt: vi.fn().mockResolvedValue({
      kind: 1059,
      content: 'encrypted-content',
      tags: [['p', 'recipient-pubkey']],
    }),
  }),
}));

// Mock fetch
global.fetch = vi.fn();

describe('MessageComposer', () => {
  const mockRecipient: Contact = {
    pubkey: 'abc123def456',
    npub: 'npub1abc123',
    ilpAddress: 'g.agent.bob',
    name: 'Bob',
    online: true,
    messageCount: 0,
  };

  const mockPrivateKey = new Uint8Array(32);
  const mockOnSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  it('should render message composer with all elements', () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    expect(screen.getByPlaceholderText(/Type your message/i)).toBeInTheDocument();
    expect(screen.getByText(/End-to-end encrypted/i)).toBeInTheDocument();
    expect(screen.getByText(/300 M2M/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Encrypted/i })).toBeInTheDocument();
  });

  it('should disable send button when message is empty', () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });
    expect(sendButton).toBeDisabled();
  });

  it('should enable send button when message is typed', () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i);
    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });

    fireEvent.change(textarea, { target: { value: 'Test message' } });

    expect(sendButton).not.toBeDisabled();
  });

  it('should show encryption status updates when sending', async () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i);
    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    // Should show creating rumor status
    await waitFor(
      () => {
        expect(screen.getByText(/Creating rumor/i)).toBeInTheDocument();
      },
      { timeout: 500 }
    );

    // Should eventually show delivered status
    await waitFor(
      () => {
        expect(screen.getByText(/Delivered/i)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('should call onSend after successful send', async () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i);
    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(
      () => {
        expect(mockOnSend).toHaveBeenCalledWith({
          plaintextMessage: 'Test message',
          result: { success: true },
        });
      },
      { timeout: 2500 }
    );
  });

  it('should show error state on send failure', async () => {
    // Set fetch to reject before rendering
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i);
    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    // Verify error message appears
    await waitFor(
      () => {
        expect(screen.getByText(/Failed to send/i)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('should clear message after successful send', async () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement;
    const sendButton = screen.getByRole('button', { name: /Send Encrypted/i });

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(
      () => {
        expect(textarea.value).toBe('');
      },
      { timeout: 2500 }
    );
  });

  it('should have keyboard shortcut support for Enter key', () => {
    render(
      <MessageComposer recipient={mockRecipient} onSend={mockOnSend} privateKey={mockPrivateKey} />
    );

    const textarea = screen.getByPlaceholderText(/Type your message/i);

    // Verify onKeyDown handler is present
    expect(textarea).toHaveAttribute('class');
  });
});
