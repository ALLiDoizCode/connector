import { render, screen, fireEvent } from '@testing-library/react';
import { EncryptionInspector } from './EncryptionInspector';

describe('EncryptionInspector', () => {
  const mockGiftwrap = {
    kind: 1059,
    pubkey: 'ephemeral123abcdef1234567890',
    created_at: 1700000000,
    content: 'encrypted_seal_content',
    tags: [['p', 'bob123']],
    id: 'giftwrap_id',
    sig: 'giftwrap_sig',
  };

  const mockSeal = {
    kind: 13,
    pubkey: 'alice123real1234567890abcdef',
    created_at: 1700000000,
    content: 'encrypted_rumor_content',
    tags: [],
    id: 'seal_id',
    sig: 'seal_signature_1234567890abcdef',
  };

  const mockRumor = {
    kind: 14,
    pubkey: 'alice123real1234567890abcdef',
    created_at: 1700000000,
    content: 'Secret message content',
    tags: [['p', 'bob123']],
  };

  it('should render collapsed by default', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    expect(screen.getByText('Encryption Layers (NIP-59)')).toBeInTheDocument();
    expect(screen.queryByText(/Layer 3/)).not.toBeInTheDocument();
  });

  it('should expand when clicked', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    expect(screen.getByText(/Layer 3/)).toBeInTheDocument();
    expect(screen.getByText(/Layer 2/)).toBeInTheDocument();
    expect(screen.getByText(/Layer 1/)).toBeInTheDocument();
  });

  it('should show ephemeral pubkey in Layer 3', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('ephemeral123abcd', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Ephemeral \(Anonymous\)/)).toBeInTheDocument();
  });

  it('should show real sender pubkey in Layer 2', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('alice123real1234', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('should show unsigned status in Layer 1', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/NONE \(Unsigned\)/)).toBeInTheDocument();
    expect(screen.getByText(/Deniable/)).toBeInTheDocument();
  });

  it('should show "What Connectors See" section', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/What ILP Connectors See:/)).toBeInTheDocument();
    expect(screen.getByText(/Destination:/)).toBeInTheDocument();
    expect(screen.getByText(/Payment: 300 M2M/)).toBeInTheDocument();
    expect(screen.getByText(/Encrypted blob:/)).toBeInTheDocument();
  });

  it('should display recipient name when provided', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
        recipientName="Bob"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Bob knows it/)).toBeInTheDocument();
  });

  it('should truncate long message content', () => {
    const longContentRumor = {
      ...mockRumor,
      content: 'This is a very long secret message that should be truncated for display purposes',
    };

    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={longContentRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    const contentDisplay = screen.getByText(/This is a very long secret mes.../);
    expect(contentDisplay).toBeInTheDocument();
  });

  it('should calculate blob size from giftwrap', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    // Blob size should be calculated as ~60% of JSON size
    const expectedSize = Math.round(JSON.stringify(mockGiftwrap).length * 0.6);
    expect(
      screen.getByText(new RegExp(`Encrypted blob: ${expectedSize} bytes`))
    ).toBeInTheDocument();
  });

  it('should show signature in Layer 2', () => {
    render(
      <EncryptionInspector
        giftwrap={mockGiftwrap}
        seal={mockSeal}
        rumor={mockRumor}
        yourPubkey="alice123real1234567890abcdef"
        recipientPubkey="bob123"
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/seal_signature_1/)).toBeInTheDocument();
  });
});
