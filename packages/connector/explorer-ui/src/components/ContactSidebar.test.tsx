import { render, screen, fireEvent } from '@testing-library/react';
import { ContactSidebar } from './ContactSidebar';
import { Contact } from '@/pages/PrivateMessenger';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock KeyManager component
vi.mock('@/components/KeyManager', () => ({
  KeyManager: () => <div>KeyManager Mock</div>,
}));

// Mock nostr-tools nip19 decode
vi.mock('nostr-tools/nip19', () => ({
  decode: vi.fn((npub: string) => {
    if (npub.startsWith('npub1')) {
      // Return a valid decoded result for test npubs
      return {
        type: 'npub',
        data: npub.replace('npub1', 'hex_'),
      };
    }
    throw new Error('Invalid npub format');
  }),
}));

describe('ContactSidebar', () => {
  const mockOnSelectContact = vi.fn();
  const mockOnAddContact = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render key manager section', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    expect(screen.getByText('🔑 Your Identity')).toBeInTheDocument();
    expect(screen.getByText('KeyManager Mock')).toBeInTheDocument();
  });

  it('should show empty state when no contacts', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    expect(screen.getByText('💬 Conversations')).toBeInTheDocument();
    expect(
      screen.getByText('No contacts yet. Add a contact to start messaging.')
    ).toBeInTheDocument();
  });

  it('should render contact list', () => {
    const contacts: Contact[] = [
      {
        pubkey: 'alice123',
        npub: 'npub1alice',
        ilpAddress: 'g.agent.alice',
        name: 'Alice',
        online: true,
        messageCount: 5,
      },
      {
        pubkey: 'bob456',
        npub: 'npub1bob',
        ilpAddress: 'g.agent.bob',
        name: 'Bob',
        online: false,
        messageCount: 2,
      },
    ];

    render(
      <ContactSidebar
        contacts={contacts}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('5 messages')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('should show online status badges', () => {
    const contacts: Contact[] = [
      {
        pubkey: 'alice123',
        npub: 'npub1alice',
        ilpAddress: 'g.agent.alice',
        name: 'Alice',
        online: true,
        messageCount: 5,
      },
      {
        pubkey: 'bob456',
        npub: 'npub1bob',
        ilpAddress: 'g.agent.bob',
        name: 'Bob',
        online: false,
        messageCount: 2,
      },
    ];

    render(
      <ContactSidebar
        contacts={contacts}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    const badges = screen.getAllByText(/🟢|🔴/);
    expect(badges).toHaveLength(2);
  });

  it('should call onSelectContact when contact is clicked', () => {
    const contacts: Contact[] = [
      {
        pubkey: 'alice123',
        npub: 'npub1alice',
        ilpAddress: 'g.agent.alice',
        name: 'Alice',
        online: true,
        messageCount: 5,
      },
    ];

    render(
      <ContactSidebar
        contacts={contacts}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    const contactElement = screen.getByText('Alice').closest('div');
    if (contactElement) {
      fireEvent.click(contactElement);
    }

    expect(mockOnSelectContact).toHaveBeenCalledWith(contacts[0]);
  });

  it('should highlight selected contact', () => {
    const contacts: Contact[] = [
      {
        pubkey: 'alice123',
        npub: 'npub1alice',
        ilpAddress: 'g.agent.alice',
        name: 'Alice',
        online: true,
        messageCount: 5,
      },
    ];

    render(
      <ContactSidebar
        contacts={contacts}
        selectedContact={contacts[0]}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    // Find the contact container that has the bg-blue-50 class
    const contactElement = screen.getByText('Alice').closest('.p-3');
    expect(contactElement).toHaveClass('bg-blue-50');
  });

  it('should show New Chat button', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    expect(screen.getByRole('button', { name: /New Chat/i })).toBeInTheDocument();
  });

  it('should open add contact dialog when New Chat is clicked', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    const newChatButton = screen.getByRole('button', { name: /New Chat/i });
    fireEvent.click(newChatButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add New Contact')).toBeInTheDocument();
  });

  it('should add new contact when form is submitted', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    // Open dialog
    const newChatButton = screen.getByRole('button', { name: /New Chat/i });
    fireEvent.click(newChatButton);

    // Fill form
    const npubInput = screen.getByPlaceholderText('npub1...');
    const ilpInput = screen.getByPlaceholderText('g.agent.alice');
    const nameInput = screen.getByPlaceholderText('Alice');

    fireEvent.change(npubInput, { target: { value: 'npub1alice123' } });
    fireEvent.change(ilpInput, { target: { value: 'g.agent.alice' } });
    fireEvent.change(nameInput, { target: { value: 'Alice' } });

    // Submit
    const addButton = screen.getByRole('button', { name: /Add Contact/i });
    fireEvent.click(addButton);

    expect(mockOnAddContact).toHaveBeenCalledWith(
      expect.objectContaining({
        npub: 'npub1alice123',
        ilpAddress: 'g.agent.alice',
        name: 'Alice',
        online: false,
        messageCount: 0,
      })
    );
  });

  it('should disable Add Contact button when required fields are empty', () => {
    render(
      <ContactSidebar
        contacts={[]}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    // Open dialog
    const newChatButton = screen.getByRole('button', { name: /New Chat/i });
    fireEvent.click(newChatButton);

    const addButton = screen.getByRole('button', { name: /Add Contact/i });
    expect(addButton).toBeDisabled();

    // Fill only npub
    const npubInput = screen.getByPlaceholderText('npub1...');
    fireEvent.change(npubInput, { target: { value: 'npub1alice123' } });
    expect(addButton).toBeDisabled();

    // Fill ILP address too
    const ilpInput = screen.getByPlaceholderText('g.agent.alice');
    fireEvent.change(ilpInput, { target: { value: 'g.agent.alice' } });
    expect(addButton).not.toBeDisabled();
  });

  it('should show contact with fallback initial when no name', () => {
    const contacts: Contact[] = [
      {
        pubkey: 'alice123',
        npub: 'npub1alice456',
        ilpAddress: 'g.agent.alice',
        online: true,
        messageCount: 0,
      },
    ];

    render(
      <ContactSidebar
        contacts={contacts}
        selectedContact={null}
        onSelectContact={mockOnSelectContact}
        onAddContact={mockOnAddContact}
      />
    );

    // Should show truncated npub instead of name
    expect(screen.getByText(/npub1alice.../)).toBeInTheDocument();
  });
});
