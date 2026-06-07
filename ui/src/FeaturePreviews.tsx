import { useState } from "react";
import { BeakerIcon } from "@primer/octicons-react";
import { AnchoredOverlay, ToggleSwitch } from "@primer/react";
import { IconButtonXSmall } from "./IconButtonXSmall";

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
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      renderAnchor={(anchorProps) => <IconButtonXSmall icon={BeakerIcon} aria-label="Feature previews" {...anchorProps} />}
    >
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, minWidth: 180 }}>
        {features.map((feature) => {
          const labelId = `feature-preview-${feature.key}`;
          return (
            <div key={feature.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
              <span id={labelId} style={{ fontSize: 12, color: "var(--fgColor-default)" }}>
                {feature.label}
              </span>
              <ToggleSwitch size="small" checked={feature.enabled} aria-labelledby={labelId} onClick={() => onToggle(feature.key)} />
            </div>
          );
        })}
      </div>
    </AnchoredOverlay>
  );
}
