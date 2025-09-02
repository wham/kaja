import { Dialog, FormControl, Select, TextInput } from "@primer/react";
import { useState, useRef } from "react";
import { RpcProtocol } from "./server/api";

interface NewProjectFormProps {
  isOpen: boolean;
  onSubmit: (project: { name: string; url: string; protocol: RpcProtocol; workspace: string }) => void;
  onClose: () => void;
}

export function NewProjectForm({ isOpen, onSubmit, onClose }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<RpcProtocol>(RpcProtocol.GRPC);
  const [workspace, setWorkspace] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (name && url) {
      onSubmit({ name, url, protocol, workspace });
      // Reset form
      setName("");
      setUrl("");
      setProtocol(RpcProtocol.GRPC);
      setWorkspace("");
    }
  };

  const handleClose = (gesture: "close-button" | "escape") => {
    // Reset form on close
    setName("");
    setUrl("");
    setProtocol(RpcProtocol.GRPC);
    setWorkspace("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title="New Project"
      width="large"
      onClose={handleClose}
      initialFocusRef={nameInputRef as React.RefObject<HTMLElement>}
      footerButtons={[
        {
          content: "Cancel",
          onClick: () => handleClose("close-button"),
        },
        {
          content: "Add Project",
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

        <FormControl sx={{ mt: 3 }}>
          <FormControl.Label>URL</FormControl.Label>
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8080" block />
        </FormControl>

        <FormControl sx={{ mt: 3 }}>
          <FormControl.Label>Protocol</FormControl.Label>
          <Select value={String(protocol)} onChange={(e) => setProtocol(Number(e.target.value) as RpcProtocol)} block>
            <Select.Option value={String(RpcProtocol.GRPC)}>gRPC</Select.Option>
            <Select.Option value={String(RpcProtocol.TWIRP)}>Twirp</Select.Option>
          </Select>
        </FormControl>

        <FormControl sx={{ mt: 3 }}>
          <FormControl.Label>Workspace</FormControl.Label>
          <TextInput value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Path to workspace" block />
        </FormControl>
      </Dialog.Body>
    </Dialog>
  );
}
