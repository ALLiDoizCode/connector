import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface ProcessingOptionsProps {
  onStepsChange: (steps: string[]) => void;
  defaultSteps?: string[];
}

const STEP_COSTS: Record<string, number> = {
  resize: 100,
  watermark: 200,
  optimize: 150,
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  resize: 'Resize to 800x600',
  watermark: 'Add watermark',
  optimize: 'Optimize file size',
};

const DEFAULT_SELECTED_STEPS = ['resize', 'watermark', 'optimize'];

export function ProcessingOptions({
  onStepsChange,
  defaultSteps = DEFAULT_SELECTED_STEPS,
}: ProcessingOptionsProps) {
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set(defaultSteps));

  const totalCost = Array.from(selectedSteps).reduce((sum, step) => sum + STEP_COSTS[step], 0);

  useEffect(() => {
    onStepsChange(Array.from(selectedSteps));
  }, [selectedSteps, onStepsChange]);

  const handleStepToggle = (step: string, checked: boolean) => {
    setSelectedSteps((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(step);
      } else {
        newSet.delete(step);
      }
      return newSet;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Processing Options</CardTitle>
        <CardDescription>Select the processing steps to apply to your image</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(STEP_COSTS).map(([step, cost]) => (
          <div key={step} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                id={step}
                checked={selectedSteps.has(step)}
                onCheckedChange={(checked) => handleStepToggle(step, checked as boolean)}
              />
              <div className="grid gap-1">
                <Label htmlFor={step} className="cursor-pointer">
                  {STEP_DESCRIPTIONS[step]}
                </Label>
              </div>
            </div>
            <span className="text-sm text-muted-foreground font-mono">{cost} msat</span>
          </div>
        ))}

        <div className="pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="font-medium">Total Cost</span>
            <span className="text-lg font-bold font-mono">{totalCost} msat</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
