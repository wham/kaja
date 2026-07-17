import { ActionList } from "./components/ui/action-list";
import { Dialog } from "./components/ui/dialog";
import { useRef } from "react";
import { appTypes } from "./appTypes";
import { PreviewPill } from "./Sidebar";

interface NewAppDialogProps {
  // When the Apps feature preview is off, only gRPC/Twirp are offered.
  appsPreviewEnabled: boolean;
  onClose: () => void;
  // Called with the chosen app type; the app's parameters are filled in afterwards
  // in the create form. The type is fixed at creation and not editable later.
  onSelect: (type: string) => void;
}

// NewAppDialog picks the type of app to create (gRPC, Twirp, or a built-in
// integration). Experimental built-ins appear only when the Apps preview is on and
// carry a "Preview" pill.
export function NewAppDialog({ appsPreviewEnabled, onClose, onSelect }: NewAppDialogProps) {
  const availableTypes = appTypes.filter((type) => !type.preview || appsPreviewEnabled);

  // Focus the first app option on open. Otherwise Primer focuses the header's close
  // button, whose "Close" tooltip then shows on focus and appears unprompted.
  const firstItemRef = useRef<HTMLLIElement>(null);

  return (
    <Dialog
      title="New app"
      width="medium"
      onClose={onClose}
      initialFocusRef={firstItemRef}
      footerButtons={[{ content: "Cancel", onClick: onClose }]}
    >
      <ActionList>
        {availableTypes.map((type, index) => {
          const Icon = type.icon;
          return (
            <ActionList.Item
              key={type.type}
              ref={index === 0 ? firstItemRef : undefined}
              onSelect={() => onSelect(type.type)}
            >
              <ActionList.LeadingVisual>
                <Icon />
              </ActionList.LeadingVisual>
              {type.label}
              {type.preview && (
                <ActionList.TrailingVisual>
                  <PreviewPill />
                </ActionList.TrailingVisual>
              )}
              <ActionList.Description variant="block">{type.description}</ActionList.Description>
            </ActionList.Item>
          );
        })}
      </ActionList>
    </Dialog>
  );
}
