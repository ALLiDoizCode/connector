import { useState, useCallback, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImageUploader } from '@/components/ImageUploader';
import { ProcessingOptions } from '@/components/ProcessingOptions';
import { ResultViewer } from '@/components/ResultViewer';
import { ProcessingIndicator } from '@/components/ProcessingIndicator';
import { processImage, ProcessingError } from '@/lib/api-client';

type WorkflowState = 'upload' | 'processing' | 'result' | 'error';

function App() {
  const [state, setState] = useState<WorkflowState>('upload');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<string[]>(['resize', 'watermark', 'optimize']);
  const [processedImage, setProcessedImage] = useState<Blob | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (originalUrl) {
        URL.revokeObjectURL(originalUrl);
      }
      if (processedUrl) {
        URL.revokeObjectURL(processedUrl);
      }
    };
  }, [originalUrl, processedUrl]);

  const handleFileSelect = useCallback((file: File) => {
    setUploadedFile(file);
    setError(null);
  }, []);

  const handleStepsChange = useCallback((steps: string[]) => {
    setSelectedSteps(steps);
  }, []);

  const handleProcessImage = useCallback(async () => {
    if (!uploadedFile) {
      setError('Please select an image first.');
      return;
    }

    if (selectedSteps.length === 0) {
      setError('Please select at least one processing step.');
      return;
    }

    setState('processing');
    setError(null);

    try {
      const blob = await processImage({
        imageFile: uploadedFile,
        steps: selectedSteps,
      });

      setProcessedImage(blob);

      if (originalUrl) {
        URL.revokeObjectURL(originalUrl);
      }
      if (processedUrl) {
        URL.revokeObjectURL(processedUrl);
      }

      const newOriginalUrl = URL.createObjectURL(uploadedFile);
      const newProcessedUrl = URL.createObjectURL(blob);

      setOriginalUrl(newOriginalUrl);
      setProcessedUrl(newProcessedUrl);
      setState('result');
    } catch (err) {
      if (err instanceof ProcessingError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
      setState('error');
    }
  }, [uploadedFile, selectedSteps, originalUrl, processedUrl]);

  const handleRetry = useCallback(() => {
    setState('upload');
    setError(null);
  }, []);

  const resetWorkflow = useCallback(() => {
    setState('upload');
    setUploadedFile(null);
    setSelectedSteps(['resize', 'watermark', 'optimize']);
    setProcessedImage(null);
    setError(null);

    if (originalUrl) {
      URL.revokeObjectURL(originalUrl);
      setOriginalUrl(null);
    }
    if (processedUrl) {
      URL.revokeObjectURL(processedUrl);
      setProcessedUrl(null);
    }
  }, [originalUrl, processedUrl]);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">ILP Workflow Demo</h1>
          <p className="text-muted-foreground">
            Upload an image and process it through the Interledger payment network
          </p>
        </div>

        {state === 'upload' && (
          <div className="space-y-6">
            <ImageUploader onFileSelect={handleFileSelect} />
            <ProcessingOptions onStepsChange={handleStepsChange} />
            <div className="flex justify-center">
              <Button
                onClick={handleProcessImage}
                disabled={!uploadedFile || selectedSteps.length === 0}
                size="lg"
              >
                Process Image
              </Button>
            </div>
          </div>
        )}

        {state === 'processing' && (
          <Card>
            <CardHeader>
              <CardTitle>Processing Image</CardTitle>
              <CardDescription>
                Your image is being processed through the ILP network
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProcessingIndicator status="Processing pipeline..." />
            </CardContent>
          </Card>
        )}

        {state === 'result' && uploadedFile && processedImage && originalUrl && processedUrl && (
          <div className="space-y-6">
            <ResultViewer
              originalFile={uploadedFile}
              processedBlob={processedImage}
              originalUrl={originalUrl}
              processedUrl={processedUrl}
            />
            <div className="flex justify-center">
              <Button onClick={resetWorkflow} variant="outline">
                Process Another Image
              </Button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <Card>
            <CardHeader>
              <CardTitle>Processing Failed</CardTitle>
              <CardDescription>An error occurred while processing your image</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-destructive/10 border border-destructive/50 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-center gap-2">
              <Button onClick={handleRetry}>Try Again</Button>
              <Button onClick={resetWorkflow} variant="outline">
                Start Over
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}

export default App;
