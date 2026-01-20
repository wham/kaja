import { FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, Radio, RadioGroup, Select, Stack, TextInput } from "@primer/react";
import { useState, useRef, useEffect } from "react";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { OpenDirectoryDialog } from "./wailsjs/go/main/App";

type ProtoSourceType = "reflection" | "protoDir";

interface ProjectFormProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: ConfigurationProject;
  onSubmit: (project: ConfigurationProject, originalName?: string) => void;
  onClose: () => void;
}

// Determine proto source type from configuration data
function getProtoSourceType(data: ConfigurationProject): ProtoSourceType {
  if (data.useReflection) return "reflection";
  return "protoDir";
}

export function ProjectForm({ isOpen, mode, initialData, onSubmit, onClose }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<RpcProtocol>(RpcProtocol.GRPC);
  const [protoDir, setProtoDir] = useState("");
  const [protoSourceType, setProtoSourceType] = useState<ProtoSourceType>("protoDir");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Populate form when editing or reset when creating
  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && initialData) {
        setName(initialData.name);
        setUrl(initialData.url);
        setProtocol(initialData.protocol);
        setProtoDir(initialData.protoDir);
        setProtoSourceType(getProtoSourceType(initialData));
      } else {
        setName("");
        setUrl("");
        setProtocol(RpcProtocol.GRPC);
        setProtoDir("");
        setProtoSourceType("protoDir");
      }
    }
  }, [isOpen, mode, initialData]);

  const handleSubmit = () => {
    if (name && url) {
      const project: ConfigurationProject = {
        name,
        url,
        protocol,
        protoDir: protoSourceType === "protoDir" ? protoDir : "",
        useReflection: protoSourceType === "reflection",
      };
      onSubmit(project, mode === "edit" ? initialData?.name : undefined);
      resetForm();
    }
  };

  const resetForm = () => {
    setName("");
    setUrl("");
    setProtocol(RpcProtocol.GRPC);
    setProtoDir("");
    setProtoSourceType("protoDir");
  };

  const handleClose = (gesture: "close-button" | "escape") => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  const isEditMode = mode === "edit";
  const title = isEditMode ? "Edit Project" : "New Project";
  const submitLabel = isEditMode ? "Save Changes" : "Add Project";

  return (
    <Dialog
      title={title}
      width="large"
      onClose={handleClose}
      initialFocusRef={nameInputRef as React.RefObject<HTMLElement>}
      footerButtons={[
        {
          content: "Cancel",
          onClick: () => handleClose("close-button"),
        },
        {
          content: submitLabel,
          buttonType: "primary",
          onClick: handleSubmit,
          disabled: !name || !url,
        },
      ]}
    >
      <Dialog.Body>
        <Stack direction="vertical" gap="spacious">
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <TextInput
              ref={nameInputRef}
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="Project name"
              block
            />
          </FormControl>

          <FormControl>
            <FormControl.Label>URL</FormControl.Label>
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8080" block />
          </FormControl>

          <FormControl>
            <FormControl.Label>Protocol</FormControl.Label>
            <Select value={String(protocol)} onChange={(e) => setProtocol(Number(e.target.value) as RpcProtocol)} block>
              <Select.Option value={String(RpcProtocol.GRPC)}>gRPC</Select.Option>
              <Select.Option value={String(RpcProtocol.TWIRP)}>Twirp</Select.Option>
            </Select>
          </FormControl>

          <RadioGroup name="protoSource" onChange={(value) => setProtoSourceType(value as ProtoSourceType)}>
            <RadioGroup.Label>Proto Source</RadioGroup.Label>
            {protocol === RpcProtocol.GRPC && (
              <FormControl>
                <Radio value="reflection" checked={protoSourceType === "reflection"} />
                <FormControl.Label>Reflection</FormControl.Label>
                <FormControl.Caption>Discover services automatically from the server</FormControl.Caption>
              </FormControl>
            )}
            <FormControl>
              <Radio value="protoDir" checked={protoSourceType === "protoDir"} />
              <FormControl.Label>Proto directory</FormControl.Label>
              <FormControl.Caption>Use all proto files from a directory</FormControl.Caption>
            </FormControl>
          </RadioGroup>

          {protoSourceType === "protoDir" && (
            <FormControl>
              <FormControl.Label>Proto Directory</FormControl.Label>
              <TextInput
                value={protoDir}
                onChange={(e) => setProtoDir(e.target.value)}
                placeholder="Path to proto directory"
                block
                trailingAction={
                  <TextInput.Action
                    onClick={async () => {
                      const path = await OpenDirectoryDialog();
                      if (path) {
                        setProtoDir(path);
                      }
                    }}
                    icon={FileDirectoryIcon}
                    aria-label="Select directory"
                  />
                }
              />
            </FormControl>
          )}
        </Stack>
      </Dialog.Body>
    </Dialog>
  );
}
