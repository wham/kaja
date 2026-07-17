import { useState } from "react";
import { BeakerIcon } from "./components/icons";
import { IconButtonXSmall } from "./IconButtonXSmall";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Switch } from "./components/ui/switch";

export interface FeaturePreview {
  key: string;
  label: string;
  enabled: boolean;
}

interface FeaturePreviewsProps {
  features: FeaturePreview[];
  onToggle: (key: string) => void;
}

export function FeaturePreviews({ features, onToggle }: FeaturePreviewsProps) {
  const [open, setOpen] = useState(false);

  if (features.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButtonXSmall icon={BeakerIcon} aria-label="Feature previews" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="p-2">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 180 }}>
          {features.map((feature) => {
            const labelId = `feature-preview-${feature.key}`;
            return (
              <div key={feature.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
                <span id={labelId} style={{ fontSize: 12, color: "var(--fgColor-default)" }}>
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
