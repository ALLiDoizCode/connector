import { useState, useCallback } from 'react';
import {
  Key,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  Plus,
  Upload,
  Trash2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useKeyManager } from '../hooks/useKeyManager';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

/**
 * KeyStatusIndicator — displays key configuration status with NOC styling.
 */
interface KeyStatusIndicatorProps {
  hasKey: boolean;
  hasError?: boolean;
}

function KeyStatusIndicator({ hasKey, hasError }: KeyStatusIndicatorProps): JSX.Element {
  if (hasError) {
    return (
      <Badge
        variant="outline"
        className="border-rose-500 text-rose-500 bg-rose-500/10"
        data-testid="key-status-error"
      >
        <AlertCircle className="h-3 w-3 mr-1" />
        Error
      </Badge>
    );
  }

  if (hasKey) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500 text-emerald-500 bg-emerald-500/10"
        data-testid="key-status-configured"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Configured
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="border-yellow-500 text-yellow-500 bg-yellow-500/10"
      data-testid="key-status-not-set"
    >
      <AlertTriangle className="h-3 w-3 mr-1" />
      Not Set
    </Badge>
  );
}

/**
 * CopyButton — click-to-copy with brief checkmark feedback.
 */
function CopyButton({ text, label }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — ignore silently
    }
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={handleCopy}
      aria-label={label || 'Copy to clipboard'}
      data-testid="copy-button"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" data-testid="copy-check" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}

/**
 * KeyMetadataSection — displays key metadata with NOC styling.
 */
function KeyMetadataSection(): JSX.Element {
  return (
    <div
      className="grid grid-cols-3 gap-4 pt-4 border-t border-border/50"
      data-testid="key-metadata"
    >
      <div className="text-center">
        <div className="text-xs text-muted-foreground uppercase">Type</div>
        <div className="text-sm font-medium mt-1">Nostr</div>
      </div>
      <div className="text-center">
        <div className="text-xs text-muted-foreground uppercase">Created</div>
        <div className="text-sm font-medium mt-1">Locally</div>
      </div>
      <div className="text-center">
        <div className="text-xs text-muted-foreground uppercase">Channels</div>
        <div className="text-sm font-medium mt-1 font-mono">0</div>
      </div>
    </div>
  );
}

/**
 * KeyManager — Nostr identity key management with NOC aesthetic styling.
 * Story 18.6: Keys Tab Security Management Interface
 */
export function KeyManager(): JSX.Element {
  const { npub, nsec, generateNewKey, importKey, clearKey } = useKeyManager();
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const handleGenerateKey = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate key generation delay
      generateNewKey();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setIsGenerating(false);
    }
  }, [generateNewKey]);

  const handleImport = useCallback(() => {
    setError(null);
    try {
      if (!importValue.trim()) {
        setError('Please enter a private key');
        return;
      }
      importKey(importValue.trim());
      setImportValue('');
      setImportDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import key');
    }
  }, [importKey, importValue]);

  const handleClearKey = useCallback(() => {
    if (confirmClear) {
      clearKey();
      setConfirmClear(false);
      setError(null);
    } else {
      setConfirmClear(true);
      // Auto-reset confirmation after 3 seconds
      setTimeout(() => setConfirmClear(false), 3000);
    }
  }, [confirmClear, clearKey]);

  // Empty state with NOC aesthetic
  if (!npub && !importDialogOpen) {
    return (
      <Card className="w-full bg-card/80 border-border/50" data-testid="key-manager-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Identity Key
            </CardTitle>
            <KeyStatusIndicator hasKey={false} hasError={!!error} />
          </div>
          <CardDescription className="text-xs">Nostr keypair for agent identity</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/50 rounded-lg">
              <AlertCircle className="h-4 w-4 text-rose-500" />
              <span className="text-sm text-rose-500">{error}</span>
            </div>
          )}

          {/* Empty State */}
          <div
            className="flex flex-col items-center justify-center py-12 text-muted-foreground"
            data-testid="empty-state"
          >
            <div
              data-testid="empty-state-icon"
              className="h-12 w-12 text-cyan-500 mb-4 animate-pulse"
            >
              <Key className="h-12 w-12" />
            </div>
            <p className="text-lg font-medium">No identity key configured</p>
            <p className="text-sm mt-1 max-w-md text-center">
              Generate a new keypair or import an existing one to establish your node&apos;s
              identity.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handleGenerateKey}
              disabled={isGenerating}
              className="flex-1"
              data-testid="generate-button"
            >
              <Plus className="h-4 w-4 mr-2" />
              {isGenerating ? 'Generating...' : 'Generate New Key'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
              className="flex-1"
              data-testid="import-button"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Key
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full bg-card/80 border-border/50" data-testid="key-manager-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" />
            Identity Key
          </CardTitle>
          <KeyStatusIndicator hasKey={!!npub} hasError={!!error} />
        </div>
        <CardDescription className="text-xs">Nostr keypair for agent identity</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/50 rounded-lg">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <span className="text-sm text-rose-500">{error}</span>
          </div>
        )}

        {/* Import Dialog (inline) */}
        {importDialogOpen && (
          <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-muted/30">
            <h3 className="font-medium">Import Private Key</h3>
            <Input
              placeholder="nsec1..."
              value={importValue}
              onChange={(e) => setImportValue(e.target.value)}
              className="font-mono text-sm"
              data-testid="import-input"
            />
            <div className="flex gap-2">
              <Button onClick={handleImport} className="flex-1" data-testid="confirm-import-button">
                Import
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImportDialogOpen(false);
                  setImportValue('');
                  setError(null);
                }}
                className="flex-1"
                data-testid="cancel-import-button"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Key Display (when key exists and not importing) */}
        {npub && !importDialogOpen && (
          <>
            {/* Public Key Display */}
            <div className="space-y-1" data-testid="npub-section">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  Public Key (npub)
                </label>
                <CopyButton text={npub} label="Copy public key" />
              </div>
              <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                <code className="font-mono text-sm break-all tabular-nums" data-testid="npub-value">
                  {npub}
                </code>
              </div>
            </div>

            {/* Private Key Display */}
            <div className="space-y-1" data-testid="nsec-section">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  Private Key (nsec)
                </label>
                <div className="flex items-center gap-1">
                  {nsec && showPrivateKey && <CopyButton text={nsec} label="Copy private key" />}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    disabled={!nsec}
                    aria-label="Toggle private key visibility"
                    data-testid="toggle-nsec-visibility"
                  >
                    {showPrivateKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                <code className="font-mono text-sm break-all tabular-nums" data-testid="nsec-value">
                  {showPrivateKey ? nsec : '•'.repeat(63)}
                </code>
              </div>
            </div>

            {/* Security Indicator */}
            <div
              className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/50 rounded-lg"
              data-testid="security-indicator"
            >
              <Lock className="h-4 w-4 text-emerald-500" />
              <span className="text-sm text-emerald-500">Key never leaves your browser</span>
            </div>

            {/* Key Metadata Section */}
            <KeyMetadataSection />

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={handleGenerateKey}
                disabled={isGenerating}
                className="flex-1"
                data-testid="regenerate-button"
              >
                <Plus className="h-4 w-4 mr-2" />
                {isGenerating ? 'Generating...' : 'Generate New Key'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(true)}
                className="flex-1"
                data-testid="import-new-button"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Key
              </Button>
              <Button
                variant="outline"
                onClick={handleClearKey}
                className={cn(
                  'flex-1',
                  confirmClear && 'border-rose-500 text-rose-500 hover:bg-rose-500/10'
                )}
                data-testid="clear-button"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {confirmClear ? 'Confirm Clear' : 'Clear Key'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
