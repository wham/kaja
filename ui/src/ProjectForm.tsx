import { FileDirectoryIcon, FileIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Dialog, FormControl, Radio, RadioGroup, Select, TextInput } from "@primer/react";
import { useState, useRef, useEffect } from "react";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { OpenDirectoryDialog, OpenMultipleFilesDialog } from "./wailsjs/go/main/App";

type ProtoSourceType = "reflection" | "protoDir" | "protoFiles";

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
  if (data.protoFiles && data.protoFiles.length > 0) return "protoFiles";
  return "protoDir";
}

export function ProjectForm({ isOpen, mode, initialData, onSubmit, onClose }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<RpcProtocol>(RpcProtocol.GRPC);
  const [protoDir, setProtoDir] = useState("");
  const [protoFiles, setProtoFiles] = useState<string[]>([]);
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
        setProtoFiles(initialData.protoFiles || []);
        setProtoSourceType(getProtoSourceType(initialData));
      } else {
        setName("");
        setUrl("");
        setProtocol(RpcProtocol.GRPC);
        setProtoDir("");
        setProtoFiles([]);
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
        protoFiles: protoSourceType === "protoFiles" ? protoFiles : [],
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
    setProtoFiles([]);
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
          <FormControl.Label>Proto Source</FormControl.Label>
          <RadioGroup name="protoSource" onChange={(value) => setProtoSourceType(value as ProtoSourceType)}>
            {protocol === RpcProtocol.GRPC && (
              <RadioGroup.Label visuallyHidden>Proto Source</RadioGroup.Label>
            )}
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
            <FormControl>
              <Radio value="protoFiles" checked={protoSourceType === "protoFiles"} />
              <FormControl.Label>Proto files</FormControl.Label>
              <FormControl.Caption>Select individual proto files</FormControl.Caption>
            </FormControl>
          </RadioGroup>
        </FormControl>

        {protoSourceType === "protoDir" && (
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
        )}

        {protoSourceType === "protoFiles" && (
          <FormControl style={{ marginTop: 24 }}>
            <FormControl.Label>Proto Files</FormControl.Label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 8,
                border: "1px solid var(--borderColor-default)",
                borderRadius: 6,
                minHeight: 80,
              }}
            >
              {protoFiles.map((file, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 4,
                    backgroundColor: "var(--bgColor-muted)",
                    borderRadius: 4,
                  }}
                >
                  <FileIcon size={16} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                    {file}
                  </span>
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                      color: "var(--fgColor-muted)",
                    }}
                    aria-label="Remove file"
                    onClick={() => setProtoFiles(protoFiles.filter((_, i) => i !== index))}
                  >
                    <XCircleFillIcon size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={async () => {
                  const files = await OpenMultipleFilesDialog();
                  if (files && files.length > 0) {
                    setProtoFiles([...protoFiles, ...files.filter((f) => !protoFiles.includes(f))]);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 8,
                  border: "1px dashed var(--borderColor-default)",
                  borderRadius: 4,
                  backgroundColor: "transparent",
                  cursor: "pointer",
                  color: "var(--fgColor-muted)",
                }}
              >
                <FileIcon size={16} />
                Add proto files...
              </button>
            </div>
          </FormControl>
        )}
      </Dialog.Body>
    </Dialog>
  );
}
