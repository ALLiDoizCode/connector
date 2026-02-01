import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { UploadIcon } from 'lucide-react';

interface ImageUploaderProps {
  onFileSelect: (file: File) => void;
  maxSizeBytes?: number;
  acceptedFormats?: string[];
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];

export function ImageUploader({
  onFileSelect,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  acceptedFormats = DEFAULT_FORMATS,
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const validateFile = useCallback(
    (file: File): boolean => {
      setError(null);

      if (!acceptedFormats.includes(file.type)) {
        setError('Unsupported format. Please use PNG, JPEG, or WebP.');
        return false;
      }

      if (file.size > maxSizeBytes) {
        setError('Your image is too large. Maximum size is 10MB.');
        return false;
      }

      return true;
    },
    [acceptedFormats, maxSizeBytes]
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!validateFile(file)) {
        // Clear any existing preview when validation fails
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
        return;
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      onFileSelect(file);
    },
    [validateFile, onFileSelect, previewUrl]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFormats.join(',')}
            onChange={handleFileChange}
            className="hidden"
          />

          {previewUrl ? (
            <div className="space-y-4">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-w-full max-h-64 mx-auto rounded-lg"
              />
              <p className="text-sm text-muted-foreground">Click or drag to replace image</p>
            </div>
          ) : (
            <div className="space-y-4">
              <UploadIcon className="w-12 h-12 mx-auto text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Drag and drop your image here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP (max 10MB)</p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </CardContent>
    </Card>
  );
}
