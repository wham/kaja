import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextInput } from "@primer/react";
import { SearchIcon } from "@primer/octicons-react";
import { Method, Project, Service } from "./project";

interface SearchResult {
  method: Method;
  service: Service;
  project: Project;
  label: string;
}

interface SearchPopupProps {
  isOpen: boolean;
  projects: Project[];
  onClose: () => void;
  onSelect: (method: Method, service: Service, project: Project) => void;
}

export function SearchPopup({ isOpen, projects, onClose, onSelect }: SearchPopupProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allMethods = useMemo(() => {
    const results: SearchResult[] = [];
    for (const project of projects) {
      for (const service of project.services) {
        for (const method of service.methods) {
          results.push({
            method,
            service,
            project,
            label: `${project.configuration.name} / ${service.name} / ${method.name}`,
          });
        }
      }
    }
    return results;
  }, [projects]);

  const filteredResults = useMemo(() => {
    if (!query.trim()) {
      return allMethods;
    }
    const lowerQuery = query.toLowerCase();
    return allMethods.filter((result) => result.label.toLowerCase().includes(lowerQuery));
  }, [allMethods, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredResults]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filteredResults.length > 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, filteredResults.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = filteredResults[selectedIndex];
        if (result) {
          onSelect(result.method, result.service, result.project);
          onClose();
        }
      }
    },
    [filteredResults, selectedIndex, onClose, onSelect]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          backgroundColor: "var(--bgColor-default)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.24)",
          border: "1px solid var(--borderColor-default)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 12 }}>
          <TextInput
            ref={inputRef}
            leadingVisual={SearchIcon}
            placeholder="Search for a method..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            block
            size="large"
          />
        </div>
        <div
          ref={listRef}
          style={{
            maxHeight: 320,
            overflowY: "auto",
            borderTop: "1px solid var(--borderColor-default)",
          }}
        >
          {filteredResults.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                color: "var(--fgColor-muted)",
                textAlign: "center",
                fontSize: 14,
              }}
            >
              No methods found
            </div>
          ) : (
            filteredResults.map((result, index) => (
              <div
                key={index}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  backgroundColor: index === selectedIndex ? "var(--bgColor-neutral-muted)" : "transparent",
                  borderLeft: index === selectedIndex ? "2px solid var(--fgColor-accent)" : "2px solid transparent",
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  onSelect(result.method, result.service, result.project);
                  onClose();
                }}
              >
                <div style={{ fontSize: 14, color: "var(--fgColor-default)" }}>{result.method.name}</div>
                <div style={{ fontSize: 12, color: "var(--fgColor-muted)", marginTop: 2 }}>
                  {result.project.configuration.name} / {result.service.name}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
