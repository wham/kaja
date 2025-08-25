import { useState } from "react";
import { Box, Button, FormControl, TextInput, Select, Text } from "@primer/react";
import { XIcon } from "@primer/octicons-react";

interface NewProjectFormProps {
  onClose: () => void;
  onSubmit: (data: ProjectData) => void;
}

export interface ProjectData {
  name: string;
  url: string;
  protocol: string;
  protoFiles: string[];
}

export function NewProjectForm({ onClose, onSubmit }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState("TWIRP");
  const [protoFiles, setProtoFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFiles = async () => {
    try {
      if ((window as any).go && (window as any).go.main && (window as any).go.main.App) {
        const files = await (window as any).go.main.App.SelectFiles();
        if (files && files.length > 0) {
          setProtoFiles(files);
          setError(null);
        }
      }
    } catch (err) {
      setError("Failed to select files: " + err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    
    if (protoFiles.length === 0) {
      setError("Please select at least one proto file");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      if ((window as any).go && (window as any).go.main && (window as any).go.main.App) {
        await (window as any).go.main.App.AddProject(name, url, protocol, protoFiles);
        onSubmit({ name, url, protocol, protoFiles });
        onClose();
      } else {
        setError("Wails environment not available");
      }
    } catch (err: any) {
      setError(err.message || "Failed to add project");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "var(--bgColor-default)",
          border: "1px solid var(--borderColor-default)",
          borderRadius: "6px",
          padding: "24px",
          width: "500px",
          maxWidth: "90%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ flex: 1, margin: 0, fontSize: "18px" }}>Add New Project</h2>
          <Button
            variant="invisible"
            onClick={onClose}
            aria-label="Close"
            leadingVisual={XIcon}
          />
        </div>

        <form onSubmit={handleSubmit}>
          <FormControl>
            <FormControl.Label>Project Name</FormControl.Label>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              disabled={isLoading}
              block
            />
          </FormControl>

          <FormControl sx={{ marginTop: 3 }}>
            <FormControl.Label>URL</FormControl.Label>
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080"
              disabled={isLoading}
              block
            />
          </FormControl>

          <FormControl sx={{ marginTop: 3 }}>
            <FormControl.Label>Protocol</FormControl.Label>
            <Select value={protocol} onChange={(e) => setProtocol(e.target.value)} disabled={isLoading}>
              <Select.Option value="TWIRP">Twirp</Select.Option>
              <Select.Option value="GRPC">gRPC</Select.Option>
            </Select>
          </FormControl>

          <FormControl sx={{ marginTop: 3 }}>
            <FormControl.Label>Proto Files</FormControl.Label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Button type="button" onClick={handleSelectFiles} disabled={isLoading}>
                Select Proto Files
              </Button>
              {protoFiles.length > 0 && (
                <Text sx={{ fontSize: 1, color: "fg.muted" }}>
                  {protoFiles.length} file{protoFiles.length > 1 ? "s" : ""} selected
                </Text>
              )}
            </div>
            {protoFiles.length > 0 && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "8px",
                  backgroundColor: "var(--bgColor-muted)",
                  borderRadius: "4px",
                  fontSize: "12px",
                  maxHeight: "150px",
                  overflow: "auto",
                }}
              >
                {protoFiles.map((file, index) => (
                  <div key={index} style={{ marginBottom: index < protoFiles.length - 1 ? "4px" : 0 }}>
                    {file.split("/").pop() || file}
                  </div>
                ))}
              </div>
            )}
          </FormControl>

          {error && (
            <div
              style={{
                marginTop: "12px",
                padding: "8px",
                backgroundColor: "var(--bgColor-danger-muted)",
                color: "var(--fgColor-danger)",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginTop: "20px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <Button type="button" variant="default" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isLoading}>
              {isLoading ? "Adding..." : "Add Project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}