// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KeyManager } from './KeyManager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

describe('KeyManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('KeyStatusIndicator', () => {
    it('should display "Not Set" badge with yellow styling when no key', () => {
      render(<KeyManager />);

      const badge = screen.getByTestId('key-status-not-set');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Not Set');
      expect(badge.className).toContain('border-yellow-500');
      expect(badge.className).toContain('text-yellow-500');
    });

    it('should display "Configured" badge with emerald styling when key exists', async () => {
      render(<KeyManager />);

      // Generate a key
      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      // Wait for key generation to complete
      await waitFor(
        () => {
          const badge = screen.getByTestId('key-status-configured');
          expect(badge).toBeInTheDocument();
          expect(badge).toHaveTextContent('Configured');
          expect(badge.className).toContain('border-emerald-500');
          expect(badge.className).toContain('text-emerald-500');
        },
        { timeout: 2000 }
      );
    });
  });

  describe('NOC Styling', () => {
    it('should apply bg-card/80 and border-border/50 classes to main card', () => {
      render(<KeyManager />);

      const card = screen.getByTestId('key-manager-card');
      expect(card.className).toContain('bg-card/80');
      expect(card.className).toContain('border-border/50');
    });

    it('should apply font-mono class to npub display', async () => {
      render(<KeyManager />);

      // Generate a key first
      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const npubValue = screen.getByTestId('npub-value');
          expect(npubValue.className).toContain('font-mono');
          expect(npubValue.className).toContain('tabular-nums');
        },
        { timeout: 2000 }
      );
    });

    it('should apply font-mono class to nsec display', async () => {
      render(<KeyManager />);

      // Generate a key first
      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const nsecValue = screen.getByTestId('nsec-value');
          expect(nsecValue.className).toContain('font-mono');
          expect(nsecValue.className).toContain('tabular-nums');
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Metadata Section', () => {
    it('should display key type as "Nostr"', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByText('Nostr')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });

    it('should display creation as "Locally"', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByText('Locally')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });

    it('should display channels count as "0"', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const metadata = screen.getByTestId('key-metadata');
          expect(metadata).toHaveTextContent('0');
        },
        { timeout: 2000 }
      );
    });

    it('should not display metadata section when no key', () => {
      render(<KeyManager />);

      expect(screen.queryByTestId('key-metadata')).not.toBeInTheDocument();
    });
  });

  describe('Clear Key Confirmation', () => {
    it('should show "Clear Key" initially', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const clearButton = screen.getByTestId('clear-button');
          expect(clearButton).toHaveTextContent('Clear Key');
        },
        { timeout: 2000 }
      );
    });

    it('should show "Confirm Clear" after first click', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByTestId('clear-button')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      const clearButton = screen.getByTestId('clear-button');
      fireEvent.click(clearButton);

      expect(clearButton).toHaveTextContent('Confirm Clear');
      expect(clearButton.className).toContain('border-rose-500');
    });

    it('should clear key after confirmation click', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByTestId('npub-value')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      // First click - show confirmation
      const clearButton = screen.getByTestId('clear-button');
      fireEvent.click(clearButton);

      // Second click - confirm clear
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
    });

    it('should apply rose styling to confirm state', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByTestId('clear-button')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      const clearButton = screen.getByTestId('clear-button');
      fireEvent.click(clearButton);

      // Verify rose styling is applied in confirm state
      expect(clearButton).toHaveTextContent('Confirm Clear');
      expect(clearButton.className).toContain('border-rose-500');
      expect(clearButton.className).toContain('text-rose-500');
    });
  });

  describe('Empty State', () => {
    it('should display Key icon with cyan color when no key', () => {
      render(<KeyManager />);

      const emptyState = screen.getByTestId('empty-state');
      expect(emptyState).toBeInTheDocument();

      const icon = screen.getByTestId('empty-state-icon');
      expect(icon.className).toContain('text-cyan-500');
    });

    it('should display pulse animation on empty state icon', () => {
      render(<KeyManager />);

      const icon = screen.getByTestId('empty-state-icon');
      expect(icon.className).toContain('animate-pulse');
    });

    it('should display generation instructions', () => {
      render(<KeyManager />);

      expect(screen.getByText('No identity key configured')).toBeInTheDocument();
      expect(
        screen.getByText(
          "Generate a new keypair or import an existing one to establish your node's identity."
        )
      ).toBeInTheDocument();
    });
  });

  describe('Copy Button', () => {
    it('should copy npub to clipboard when copy button clicked', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getAllByTestId('copy-button').length).toBeGreaterThan(0);
        },
        { timeout: 2000 }
      );

      const copyButtons = screen.getAllByTestId('copy-button');
      // First copy button is for npub
      fireEvent.click(copyButtons[0]);
      expect(mockClipboard.writeText).toHaveBeenCalled();
    });

    it('should show checkmark feedback after copy', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getAllByTestId('copy-button').length).toBeGreaterThan(0);
        },
        { timeout: 2000 }
      );

      const copyButtons = screen.getAllByTestId('copy-button');
      fireEvent.click(copyButtons[0]);

      // Check for checkmark icon appears immediately after click
      await waitFor(() => {
        const checkIcon = screen.getByTestId('copy-check');
        expect(checkIcon).toBeInTheDocument();
        // SVG elements have className as SVGAnimatedString, use getAttribute
        expect(checkIcon.getAttribute('class')).toContain('text-emerald-500');
      });
    });
  });

  describe('Security Indicator', () => {
    it('should display emerald color on security indicator with Lock icon', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const securityIndicator = screen.getByTestId('security-indicator');
          expect(securityIndicator).toBeInTheDocument();
          expect(securityIndicator.className).toContain('bg-emerald-500/10');
          expect(securityIndicator.className).toContain('border-emerald-500/50');
          expect(screen.getByText('Key never leaves your browser')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Key Generation', () => {
    it('should generate a new key when generate button clicked', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const npubValue = screen.getByTestId('npub-value');
          expect(npubValue.textContent).toMatch(/^npub1/);
        },
        { timeout: 2000 }
      );
    });

    it('should show generating state while generating', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      // The "Generating..." text should appear immediately after click
      expect(screen.getByText('Generating...')).toBeInTheDocument();

      await waitFor(
        () => {
          expect(screen.queryByText('Generating...')).not.toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Private Key Visibility', () => {
    it('should hide private key by default', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          const nsecValue = screen.getByTestId('nsec-value');
          // Should show dots, not the actual key
          expect(nsecValue.textContent).toContain('•');
          expect(nsecValue.textContent).not.toMatch(/^nsec1/);
        },
        { timeout: 2000 }
      );
    });

    it('should show private key when toggle clicked', async () => {
      render(<KeyManager />);

      const generateButton = screen.getByTestId('generate-button');
      fireEvent.click(generateButton);

      await waitFor(
        () => {
          expect(screen.getByTestId('toggle-nsec-visibility')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      const toggleButton = screen.getByTestId('toggle-nsec-visibility');
      fireEvent.click(toggleButton);

      const nsecValue = screen.getByTestId('nsec-value');
      expect(nsecValue.textContent).toMatch(/^nsec1/);
    });
  });

  describe('Import Key', () => {
    it('should open import dialog when import button clicked', () => {
      render(<KeyManager />);

      const importButton = screen.getByTestId('import-button');
      fireEvent.click(importButton);

      expect(screen.getByTestId('import-input')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-import-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-import-button')).toBeInTheDocument();
    });

    it('should close import dialog when cancel clicked', () => {
      render(<KeyManager />);

      const importButton = screen.getByTestId('import-button');
      fireEvent.click(importButton);

      const cancelButton = screen.getByTestId('cancel-import-button');
      fireEvent.click(cancelButton);

      expect(screen.queryByTestId('import-input')).not.toBeInTheDocument();
    });
  });
});
