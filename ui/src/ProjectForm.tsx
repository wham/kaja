import { FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, Select, TextInput } from "@primer/react";
import { useState, useRef, useEffect } from "react";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { OpenDirectoryDialog } from "./wailsjs/go/main/App";

interface ProjectFormProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: ConfigurationProject;
  onSubmit: (project: ConfigurationProject, originalName?: string) => void;
  onClose: () => void;
}

export function ProjectForm({ isOpen, mode, initialData, onSubmit, onClose }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<RpcProtocol>(RpcProtocol.GRPC);
  const [protoDir, setProtoDir] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Populate form when editing or reset when creating
  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && initialData) {
        setName(initialData.name);
        setUrl(initialData.url);
        setProtocol(initialData.protocol);
        setProtoDir(initialData.protoDir);
      } else {
        setName("");
        setUrl("");
        setProtocol(RpcProtocol.GRPC);
        setProtoDir("");
      }
    }
  }, [isOpen, mode, initialData]);

  const handleSubmit = () => {
    if (name && url) {
      onSubmit({ name, url, protocol, protoDir }, mode === "edit" ? initialData?.name : undefined);
      resetForm();
    }
  };

  const resetForm = () => {
    setName("");
    setUrl("");
    setProtocol(RpcProtocol.GRPC);
    setProtoDir("");
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

        <FormControl style={{ marginTop: 24 }}>
          <FormControl.Label>URL</FormControl.Label>
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8080" block />
        </FormControl>

        <FormControl style={{ marginTop: 24 }}>
          <FormControl.Label>Protocol</FormControl.Label>
          <Select value={String(protocol)} onChange={(e) => setProtocol(Number(e.target.value) as RpcProtocol)} block>
            <Select.Option value={String(RpcProtocol.GRPC)}>gRPC</Select.Option>
            <Select.Option value={String(RpcProtocol.TWIRP)}>Twirp</Select.Option>
          </Select>
        </FormControl>

        <FormControl style={{ marginTop: 24 }}>
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
      </Dialog.Body>
    </Dialog>
  );
}
