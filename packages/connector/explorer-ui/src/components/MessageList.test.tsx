import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import { Message } from '@/pages/PrivateMessenger';
import { describe, it, expect, beforeAll } from 'vitest';

// Mock scrollIntoView for jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe('MessageList', () => {
  const currentUserPubkey = 'user123';

  it('should show empty state when no messages', () => {
    render(<MessageList messages={[]} currentUserPubkey={currentUserPubkey} />);

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByText('Send your first encrypted message!')).toBeInTheDocument();
  });

  it('should render sent messages', () => {
    const messages: Message[] = [
      {
        id: '1',
        from: currentUserPubkey,
        to: 'alice123',
        content: 'Hello Alice!',
        timestamp: Date.now(),
        encrypted: true,
        delivered: true,
        cost: 300,
        direction: 'sent',
      },
    ];

    render(<MessageList messages={messages} currentUserPubkey={currentUserPubkey} />);

    expect(screen.getByText('Hello Alice!')).toBeInTheDocument();
    expect(screen.getByText('🔒 Encrypted')).toBeInTheDocument();
    expect(screen.getByText('✅ Delivered')).toBeInTheDocument();
    expect(screen.getByText('💰 300 M2M')).toBeInTheDocument();
  });

  it('should render received messages', () => {
    const messages: Message[] = [
      {
        id: '1',
        from: 'alice123',
        to: currentUserPubkey,
        content: 'Hello from Alice!',
        timestamp: Date.now(),
        encrypted: true,
        delivered: true,
        direction: 'received',
      },
    ];

    render(<MessageList messages={messages} currentUserPubkey={currentUserPubkey} />);

    expect(screen.getByText('Hello from Alice!')).toBeInTheDocument();
    expect(screen.getByText(/alice123/i)).toBeInTheDocument(); // Sender pubkey shown
    expect(screen.getByText('🔒 Encrypted')).toBeInTheDocument();
    // Should NOT show delivered badge for received messages
    expect(screen.queryByText('✅ Delivered')).not.toBeInTheDocument();
  });

  it('should render multiple messages in order', () => {
    const messages: Message[] = [
      {
        id: '1',
        from: currentUserPubkey,
        to: 'alice123',
        content: 'First message',
        timestamp: Date.now() - 2000,
        encrypted: true,
        delivered: true,
        direction: 'sent',
      },
      {
        id: '2',
        from: 'alice123',
        to: currentUserPubkey,
        content: 'Second message',
        timestamp: Date.now() - 1000,
        encrypted: true,
        delivered: true,
        direction: 'received',
      },
      {
        id: '3',
        from: currentUserPubkey,
        to: 'alice123',
        content: 'Third message',
        timestamp: Date.now(),
        encrypted: true,
        delivered: true,
        direction: 'sent',
      },
    ];

    render(<MessageList messages={messages} currentUserPubkey={currentUserPubkey} />);

    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.getByText('Third message')).toBeInTheDocument();
  });

  it('should show timestamp for each message', () => {
    const now = new Date('2024-01-01T12:34:56');
    const messages: Message[] = [
      {
        id: '1',
        from: currentUserPubkey,
        to: 'alice123',
        content: 'Test message',
        timestamp: now.getTime(),
        encrypted: true,
        delivered: true,
        direction: 'sent',
      },
    ];

    render(<MessageList messages={messages} currentUserPubkey={currentUserPubkey} />);

    // Should show time in HH:MM format (12:34 PM in 12-hour format)
    const timeString = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(timeString)).toBeInTheDocument();
  });
});
