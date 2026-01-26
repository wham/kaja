import { FileDirectoryIcon } from "@primer/octicons-react";
import { Button, FormControl, Radio, RadioGroup, SegmentedControl, Select, Stack, TextInput } from "@primer/react";
import * as monaco from "monaco-editor";
import { useState, useRef, useEffect, useCallback } from "react";
import { ConfigurationProject as ConfigurationProjectType, ConfigurationProject, RpcProtocol } from "./server/api";
import { OpenDirectoryDialog } from "./wailsjs/go/main/App";
import { formatJson } from "./formatter";
import { generateJsonSchema } from "./jsonSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonDefaults = (monaco.languages as any).json.jsonDefaults;

type ProtoSourceType = "reflection" | "protoDir";
type EditMode = "form" | "json";

const projectJsonSchema = generateJsonSchema(ConfigurationProjectType, {
  required: ["name", "url"],
  enumValues: { protocol: ["RPC_PROTOCOL_GRPC", "RPC_PROTOCOL_TWIRP"] },
});

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  schemas: [
    {
      uri: "http://kaja/project-schema.json",
      fileMatch: ["*"],
      schema: projectJsonSchema,
    },
  ],
});

const NEW_PROJECT_VALUE = "__new__";

interface ProjectFormProps {
  mode: "create" | "edit";
  initialData?: ConfigurationProject;
  allProjects: ConfigurationProject[];
  onSubmit: (project: ConfigurationProject, originalName?: string) => void;
  onCancel: () => void;
  onProjectSelect: (projectName: string | null) => void;
}

function getProtoSourceType(data: ConfigurationProject): ProtoSourceType {
  if (data.useReflection) return "reflection";
  return "protoDir";
}

function createEmptyProject(): ConfigurationProject {
  return {
    name: "",
    url: "",
    protocol: RpcProtocol.GRPC,
    protoDir: "",
    useReflection: false,
    headers: {},
  };
}

function projectToJson(project: ConfigurationProject): object {
  return {
    name: project.name,
    protocol: project.protocol === RpcProtocol.GRPC ? "RPC_PROTOCOL_GRPC" : project.protocol === RpcProtocol.TWIRP ? "RPC_PROTOCOL_TWIRP" : "RPC_PROTOCOL_UNSPECIFIED",
    url: project.url,
    protoDir: project.protoDir,
    useReflection: project.useReflection,
    headers: project.headers,
  };
}

function jsonToProject(json: any): ConfigurationProject {
  let protocol = RpcProtocol.GRPC;
  if (json.protocol === "RPC_PROTOCOL_TWIRP") {
    protocol = RpcProtocol.TWIRP;
  } else if (json.protocol === "RPC_PROTOCOL_GRPC") {
    protocol = RpcProtocol.GRPC;
  } else if (typeof json.protocol === "number") {
    protocol = json.protocol;
  }

  return {
    name: json.name || "",
    url: json.url || "",
    protocol,
    protoDir: json.protoDir || "",
    useReflection: json.useReflection ?? false,
    headers: json.headers || {},
  };
}

export function ProjectForm({ mode, initialData, allProjects, onSubmit, onCancel, onProjectSelect }: ProjectFormProps) {
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<RpcProtocol>(RpcProtocol.GRPC);
  const [protoDir, setProtoDir] = useState("");
  const [protoSourceType, setProtoSourceType] = useState<ProtoSourceType>("protoDir");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoModelRef = useRef<monaco.editor.ITextModel | null>(null);

  const getCurrentProject = useCallback((): ConfigurationProject => {
    return {
      name,
      url,
      protocol,
      protoDir: protoSourceType === "protoDir" ? protoDir : "",
      useReflection: protoSourceType === "reflection",
      headers: initialData?.headers ?? {},
    };
  }, [name, url, protocol, protoDir, protoSourceType, initialData?.headers]);

  const updateFormFromProject = useCallback((project: ConfigurationProject) => {
    setName(project.name);
    setUrl(project.url);
    setProtocol(project.protocol);
    setProtoDir(project.protoDir);
    setProtoSourceType(getProtoSourceType(project));
  }, []);

  useEffect(() => {
    if (mode === "edit" && initialData) {
      updateFormFromProject(initialData);
    } else {
      const empty = createEmptyProject();
      updateFormFromProject(empty);
    }
  }, [mode, initialData, updateFormFromProject]);

  // Track which project is currently loaded in the JSON editor
  const loadedProjectNameRef = useRef<string | null>(null);

  // Get the project data to display in JSON editor
  const getJsonProjectData = useCallback((): ConfigurationProject => {
    if (mode === "edit" && initialData) {
      return initialData;
    }
    return createEmptyProject();
  }, [mode, initialData]);

  useEffect(() => {
    if (editMode === "json" && editorContainerRef.current) {
      const projectData = getJsonProjectData();
      const currentProjectKey = mode === "edit" ? initialData?.name : "__new__";

      if (!editorRef.current) {
        // Create new editor
        loadedProjectNameRef.current = currentProjectKey ?? null;
        const jsonStr = JSON.stringify(projectToJson(projectData), null, 2);

        const modelUri = monaco.Uri.file("/project-config.json");
        const existingModel = monaco.editor.getModel(modelUri);
        if (existingModel) {
          existingModel.dispose();
        }
        monacoModelRef.current = monaco.editor.createModel(jsonStr, "json", modelUri);

        editorRef.current = monaco.editor.create(editorContainerRef.current, {
          model: monacoModelRef.current,
          theme: "vs-dark",
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
          minimap: { enabled: false },
          renderLineHighlight: "none",
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
        });

        formatJson(jsonStr).then((formatted) => {
          if (monacoModelRef.current) {
            monacoModelRef.current.setValue(formatted);
          }
        });
      } else if (loadedProjectNameRef.current !== currentProjectKey) {
        // Project changed - update editor content
        loadedProjectNameRef.current = currentProjectKey ?? null;
        const jsonStr = JSON.stringify(projectToJson(projectData), null, 2);

        formatJson(jsonStr).then((formatted) => {
          if (monacoModelRef.current) {
            monacoModelRef.current.setValue(formatted);
          }
        });
      }
    }

    return () => {
      if (editMode !== "json") {
        editorRef.current?.dispose();
        editorRef.current = null;
        monacoModelRef.current?.dispose();
        monacoModelRef.current = null;
        loadedProjectNameRef.current = null;
      }
    };
  }, [editMode, mode, initialData, getJsonProjectData]);

  const handleModeChange = async (index: number) => {
    const newMode = index === 0 ? "form" : "json";

    if (newMode === "json" && editMode === "form") {
      setEditMode(newMode);
      setJsonError(null);
    } else if (newMode === "form" && editMode === "json") {
      if (editorRef.current) {
        const jsonValue = editorRef.current.getValue();
        try {
          const parsed = JSON.parse(jsonValue);
          const project = jsonToProject(parsed);
          updateFormFromProject(project);
          setJsonError(null);
          editorRef.current?.dispose();
          editorRef.current = null;
          monacoModelRef.current?.dispose();
          monacoModelRef.current = null;
          setEditMode(newMode);
        } catch {
          setJsonError("Invalid JSON. Fix errors before switching to Form mode.");
        }
      } else {
        setEditMode(newMode);
      }
    }
  };

  const handleSubmit = () => {
    let projectToSubmit: ConfigurationProject;

    if (editMode === "json" && editorRef.current) {
      const jsonValue = editorRef.current.getValue();
      try {
        const parsed = JSON.parse(jsonValue);
        projectToSubmit = jsonToProject(parsed);
        projectToSubmit.headers = { ...initialData?.headers, ...projectToSubmit.headers };
      } catch {
        setJsonError("Invalid JSON. Please fix errors before saving.");
        return;
      }
    } else {
      projectToSubmit = getCurrentProject();
    }

    if (projectToSubmit.name && projectToSubmit.url) {
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoModelRef.current?.dispose();
      monacoModelRef.current = null;
      onSubmit(projectToSubmit, mode === "edit" ? initialData?.name : undefined);
    }
  };

  const handleCancel = () => {
    editorRef.current?.dispose();
    editorRef.current = null;
    monacoModelRef.current?.dispose();
    monacoModelRef.current = null;
    onCancel();
  };

  const submitLabel = mode === "edit" ? "Save Changes" : "Add Project";

  const isValid = editMode === "form" ? name && url : !jsonError;

  const selectedProjectValue = mode === "edit" && initialData?.name ? initialData.name : NEW_PROJECT_VALUE;

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setJsonError(null);

    if (value === NEW_PROJECT_VALUE) {
      onProjectSelect(null);
    } else {
      onProjectSelect(value);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bgColor-default)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--borderColor-default)" }}>
        <Select value={selectedProjectValue} onChange={handleProjectChange} style={{ minWidth: 200 }}>
          <Select.Option value={NEW_PROJECT_VALUE}>+ New Project</Select.Option>
          {allProjects.length > 0 && <Select.OptGroup label="Edit existing">{allProjects.map((p) => (
            <Select.Option key={p.name} value={p.name}>
              {p.name}
            </Select.Option>
          ))}</Select.OptGroup>}
        </Select>
        <SegmentedControl aria-label="Edit mode" onChange={handleModeChange}>
          <SegmentedControl.Button selected={editMode === "form"}>Form</SegmentedControl.Button>
          <SegmentedControl.Button selected={editMode === "json"}>JSON</SegmentedControl.Button>
        </SegmentedControl>
      </div>

      {jsonError && (
        <div style={{ padding: "8px 16px", background: "var(--bgColor-danger-muted)", color: "var(--fgColor-danger)", fontSize: 14 }}>
          {jsonError}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {editMode === "form" ? (
          <div style={{ maxWidth: 600, padding: 16 }}>
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
                <Select
                  value={String(protocol)}
                  onChange={(e) => {
                    const newProtocol = Number(e.target.value) as RpcProtocol;
                    setProtocol(newProtocol);
                    if (newProtocol === RpcProtocol.TWIRP && protoSourceType === "reflection") {
                      setProtoSourceType("protoDir");
                    }
                  }}
                  block
                >
                  <Select.Option value={String(RpcProtocol.GRPC)}>gRPC</Select.Option>
                  <Select.Option value={String(RpcProtocol.TWIRP)}>Twirp</Select.Option>
                </Select>
              </FormControl>

              <RadioGroup
                name="protoSource"
                onChange={(value) => {
                  if (protocol === RpcProtocol.GRPC || value !== "reflection") {
                    setProtoSourceType(value as ProtoSourceType);
                  }
                }}
              >
                <RadioGroup.Label>Proto Source</RadioGroup.Label>
                <FormControl disabled={protocol === RpcProtocol.TWIRP}>
                  <Radio
                    value="reflection"
                    checked={protoSourceType === "reflection"}
                    disabled={protocol === RpcProtocol.TWIRP}
                  />
                  <FormControl.Label>Reflection</FormControl.Label>
                  <FormControl.Caption>
                    {protocol === RpcProtocol.TWIRP
                      ? "Twirp does not support reflection"
                      : "Discover services automatically from the server"}
                  </FormControl.Caption>
                </FormControl>
                <FormControl>
                  <Radio value="protoDir" checked={protoSourceType === "protoDir"} />
                  <FormControl.Label>Proto directory</FormControl.Label>
                  <FormControl.Caption>Use all proto files from a directory</FormControl.Caption>
                </FormControl>
              </RadioGroup>

              <FormControl disabled={protoSourceType === "reflection"}>
                <FormControl.Label>Proto Directory</FormControl.Label>
                <TextInput
                  value={protoDir}
                  onChange={(e) => setProtoDir(e.target.value)}
                  placeholder="Path to proto directory"
                  block
                  disabled={protoSourceType === "reflection"}
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
                      disabled={protoSourceType === "reflection"}
                    />
                  }
                />
              </FormControl>
            </Stack>
          </div>
        ) : (
          <div ref={editorContainerRef} style={{ height: "100%", minHeight: 300 }} />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 16, borderTop: "1px solid var(--borderColor-default)" }}>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!isValid}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
