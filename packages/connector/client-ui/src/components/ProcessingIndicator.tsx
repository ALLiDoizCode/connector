import { Progress } from '@/components/ui/progress';
import { LoaderIcon } from 'lucide-react';

interface ProcessingIndicatorProps {
  status?: string;
}

export function ProcessingIndicator({ status = 'Processing...' }: ProcessingIndicatorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <div className="relative">
        <LoaderIcon className="w-16 h-16 text-primary animate-spin" />
      </div>

      <div className="space-y-2 text-center">
        <p className="text-lg font-medium">{status}</p>
        <p className="text-sm text-muted-foreground">This usually takes 2-3 seconds</p>
      </div>

      <Progress value={undefined} className="w-64" />
    </div>
  );
}
