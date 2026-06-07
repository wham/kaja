import { BeakerIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu } from "@primer/react";
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
  if (features.length === 0) {
    return null;
  }

  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButtonXSmall icon={BeakerIcon} aria-label="Feature previews" />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay width="small">
        <ActionList selectionVariant="multiple">
          {features.map((feature) => (
            <ActionList.Item key={feature.key} selected={feature.enabled} onSelect={() => onToggle(feature.key)}>
              {feature.label}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  );
}
