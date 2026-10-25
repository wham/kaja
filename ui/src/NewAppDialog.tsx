import { ActionList } from "./components/action-list";
import { Dialog } from "./components/dialog";
import { useRef } from "react";
import { appTypes } from "./appTypes";
import { PreviewPill } from "./PreviewPill";

interface NewAppDialogProps {
  // When the Apps feature preview is off, only OpenAPI/MCP/gRPC/Twirp are offered.
  appsPreviewEnabled: boolean;
  onClose: () => void;
  // Called with the chosen app type; the app's parameters are filled in afterwards
  // in the create form. The type is fixed at creation and not editable later.
  onSelect: (type: string) => void;
}

// NewAppDialog picks the type of app to create (OpenAPI, MCP, gRPC, Twirp, or a
// built-in integration). Experimental built-ins appear only when the Apps
// preview is on and carry a "Preview" pill.
export function NewAppDialog({ appsPreviewEnabled, onClose, onSelect }: NewAppDialogProps) {
  const availableTypes = appTypes.filter((type) => !type.preview || appsPreviewEnabled);
  const rows = availableTypes.filter((type) => !type.minor);
  const lines = availableTypes.filter((type) => type.minor);

  // Focus the first app option on open, so focus doesn't land on the header's
  // close button.
  const firstItemRef = useRef<HTMLLIElement>(null);

  return (
    <Dialog title="New app" onClose={onClose} initialFocusRef={firstItemRef} footerButtons={[{ content: "Cancel", onClick: onClose }]}>
      <ActionList>
        {rows.map((type, index) => {
          const Icon = type.icon;
          return (
            <ActionList.Item key={type.type} ref={index === 0 ? firstItemRef : undefined} onSelect={() => onSelect(type.type)}>
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
      {lines.map((type) => {
        const Icon = type.icon;
        return (
          <button
            key={type.type}
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(type.type)}
          >
            <Icon size={13} />
            Add a {type.label} app
          </button>
        );
      })}
    </Dialog>
  );
}
