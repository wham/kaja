import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { IconButton } from "./components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { Switch } from "./components/switch";

export interface FeaturePreview {
  key: string;
  label: string;
  enabled: boolean;
}

interface FeaturePreviewsProps {
  features: FeaturePreview[];
  onToggle: (key: string) => void;
  className?: string;
}

export function FeaturePreviews({ features, onToggle, className }: FeaturePreviewsProps) {
  const [open, setOpen] = useState(false);

  if (features.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton size="xs" variant="ghost" tooltip="native" icon={FlaskConical} aria-label="Feature previews" className={className} />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="p-2">
        <div className="flex min-w-[180px] flex-col gap-2">
          {features.map((feature) => {
            const labelId = `feature-preview-${feature.key}`;
            return (
              <div key={feature.key} className="flex items-center justify-between gap-6">
                <span id={labelId} className="text-xs text-foreground">
                  {feature.label}
                </span>
                <Switch checked={feature.enabled} aria-labelledby={labelId} onCheckedChange={() => onToggle(feature.key)} />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
