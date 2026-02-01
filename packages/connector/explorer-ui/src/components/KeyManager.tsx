import { useState, useCallback } from 'react';
import { Key, Lock, Eye, EyeOff, Copy, Plus, Upload, AlertCircle } from 'lucide-react';
import { useKeyManager } from '../hooks/useKeyManager';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function KeyManager() {
  const { npub, nsec, generateNewKey, importKey } = useKeyManager();
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importValue, setImportValue] = useState('');

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

  const copyPublicKey = useCallback(() => {
    if (npub) {
      navigator.clipboard.writeText(npub);
    }
  }, [npub]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Key className="h-4 w-4" />
          Your Identity
        </CardTitle>
        <CardDescription className="text-xs">
          Private key stored securely in your browser
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
          </div>
        )}

        {/* Public Key Display */}
        <div>
          <label className="text-sm font-medium" htmlFor="npub-input">
            Public Key (npub)
          </label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              id="npub-input"
              value={npub || 'No key loaded'}
              readOnly
              className="font-mono text-sm"
              aria-label="Public key (npub)"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={copyPublicKey}
              disabled={!npub}
              aria-label="Copy public key"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Private Key (Hidden by Default) */}
        <div>
          <label className="text-sm font-medium" htmlFor="nsec-input">
            Private Key (nsec)
          </label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              id="nsec-input"
              type={showPrivateKey ? 'text' : 'password'}
              value={nsec || 'Not loaded'}
              readOnly
              className="font-mono text-sm"
              aria-label="Private key (nsec)"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
              disabled={!nsec}
              aria-label="Toggle private key visibility"
            >
              {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Security Indicator */}
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
          <Lock className="h-4 w-4 text-green-600 dark:text-green-400" />
          <span className="text-sm text-green-700 dark:text-green-400">
            Key never leaves your browser
          </span>
        </div>

        {/* Import Dialog (inline) */}
        {importDialogOpen && (
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-medium">Import Private Key</h3>
            <Input
              placeholder="nsec1..."
              value={importValue}
              onChange={(e) => setImportValue(e.target.value)}
              className="font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button onClick={handleImport} className="flex-1">
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
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!importDialogOpen && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handleGenerateKey}
              disabled={isGenerating}
              className="flex-1"
            >
              <Plus className="h-4 w-4 mr-2" />
              {isGenerating ? 'Generating...' : 'Generate New Key'}
            </Button>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="flex-1">
              <Upload className="h-4 w-4 mr-2" />
              Import Key
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
