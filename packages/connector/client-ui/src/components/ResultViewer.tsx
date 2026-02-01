import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';

interface ImageMetadata {
  originalSize: number;
  processedSize: number;
  originalDimensions: { width: number; height: number };
  processedDimensions: { width: number; height: number };
}

interface ResultViewerProps {
  originalFile: File;
  processedBlob: Blob;
  originalUrl: string;
  processedUrl: string;
}

export function ResultViewer({
  originalFile,
  processedBlob,
  originalUrl,
  processedUrl,
}: ResultViewerProps) {
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);

  useEffect(() => {
    const loadMetadata = async () => {
      const [originalDims, processedDims] = await Promise.all([
        loadImageDimensions(originalUrl),
        loadImageDimensions(processedUrl),
      ]);

      setMetadata({
        originalSize: originalFile.size,
        processedSize: processedBlob.size,
        originalDimensions: originalDims,
        processedDimensions: processedDims,
      });
    };

    loadMetadata();
  }, [originalFile, processedBlob, originalUrl, processedUrl]);

  const loadImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = processedUrl;
    link.download = `processed-${originalFile.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Processing Complete</CardTitle>
        <CardDescription>Your image has been successfully processed</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Before</h3>
            <img src={originalUrl} alt="Original" className="w-full rounded-lg border" />
            {metadata && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <p>Size: {formatBytes(metadata.originalSize)}</p>
                <p>
                  Dimensions: {metadata.originalDimensions.width}x
                  {metadata.originalDimensions.height}
                </p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">After</h3>
            <img src={processedUrl} alt="Processed" className="w-full rounded-lg border" />
            {metadata && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <p>Size: {formatBytes(metadata.processedSize)}</p>
                <p>
                  Dimensions: {metadata.processedDimensions.width}x
                  {metadata.processedDimensions.height}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <Button onClick={handleDownload} size="lg">
            <DownloadIcon className="mr-2" />
            Download Processed Image
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
