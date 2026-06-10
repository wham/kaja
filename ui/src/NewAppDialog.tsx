import { Button, Dialog, Flash, FormControl, Link, TextInput, Tooltip } from "@primer/react";
import { FileIcon, LightBulbIcon } from "@primer/octicons-react";
import { useState } from "react";
import { appTypes, AppTypeDefinition } from "./appTypes";
import { ConfigurationApp } from "./server/api";
import { PreviewPill } from "./Sidebar";
import { isWailsEnvironment } from "./wails";
import { OpenFileDialog } from "./wailsjs/go/main/App";

interface NewAppDialogProps {
  // Existing project and app names, used to reject duplicates.
  existingNames: string[];
  onClose: () => void;
  onCreate: (app: ConfigurationApp) => Promise<void>;
}

// NewAppDialog walks the user through creating a built-in app: first a grid to
// pick the app type, then a form with that type's parameters.
export function NewAppDialog({ existingNames, onClose, onCreate }: NewAppDialogProps) {
  const [selected, setSelected] = useState<AppTypeDefinition | null>(null);
  const [name, setName] = useState("");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  const selectType = (type: AppTypeDefinition) => {
    setSelected(type);
    setName("");
    setParameters({});
    setError(undefined);
  };

  const submit = async () => {
    if (!selected) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    const params: Record<string, string> = {};
    for (const parameter of selected.parameters) {
      const value = (parameters[parameter.key] ?? "").trim();
      if (!value) {
        setError(`${parameter.label} is required`);
        return;
      }
      params[parameter.key] = value;
    }
    if (existingNames.includes(trimmedName)) {
      setError("A project or app with this name already exists");
      return;
    }
    setError(undefined);
    setCreating(true);
    try {
      await onCreate({ name: trimmedName, type: selected.type, parameters: params, headers: {} });
    } finally {
      setCreating(false);
    }
  };

  const title = (
    <>
      New App
      <PreviewPill />
    </>
  );

  if (!selected) {
    return (
      <Dialog title={title} width="medium" onClose={onClose} footerButtons={[{ content: "Cancel", onClick: onClose }]}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {appTypes.map((type) => (
            <Tooltip key={type.type} text={type.description} direction="s">
              <Button block size="large" leadingVisual={type.icon} onClick={() => selectType(type)}>
                {type.label}
              </Button>
            </Tooltip>
          ))}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      width="medium"
      onClose={onClose}
      footerButtons={[
        { content: "Back", onClick: () => setSelected(null) },
        { content: "Create", buttonType: "primary", onClick: submit, disabled: creating },
      ]}
    >
      <FormControl>
        <FormControl.Label>Name</FormControl.Label>
        <TextInput block autoFocus placeholder={selected.label} value={name} onChange={(e) => setName(e.target.value)} />
      </FormControl>
      {selected.parameters.map((parameter) => (
        <div key={parameter.key} style={{ marginTop: 16 }}>
          <FormControl>
            <FormControl.Label>{parameter.label}</FormControl.Label>
            <TextInput
              block
              placeholder={parameter.placeholder}
              value={parameters[parameter.key] ?? ""}
              onChange={(e) => setParameters((prev) => ({ ...prev, [parameter.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              trailingAction={
                parameter.type === "file" && isWailsEnvironment() ? (
                  <TextInput.Action
                    icon={FileIcon}
                    aria-label="Select file"
                    onClick={async () => {
                      const path = await OpenFileDialog();
                      if (path) {
                        setParameters((prev) => ({ ...prev, [parameter.key]: path }));
                      }
                    }}
                  />
                ) : undefined
              }
            />
            {parameter.caption && <FormControl.Caption>{parameter.caption}</FormControl.Caption>}
          </FormControl>
        </div>
      ))}
      {selected.demo && (
        <div style={{ marginTop: 8 }}>
          <Link
            as="button"
            type="button"
            onClick={() => {
              setError(undefined);
              setName(selected.demo!.name);
              setParameters({ ...selected.demo!.parameters });
            }}
            style={{ fontSize: 12, lineHeight: "18px", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <LightBulbIcon size={12} />
            {selected.demo.label}
          </Link>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 16 }}>
          <Flash variant="danger">{error}</Flash>
        </div>
      )}
    </Dialog>
  );
}
