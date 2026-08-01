import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { Input } from "./components/input";
import { Search } from "lucide-react";
import { Method, App, Service } from "./apps";

interface SearchResult {
  method: Method;
  service: Service;
  app: App;
  label: string;
}

interface SearchPopupProps {
  isOpen: boolean;
  apps: App[];
  onClose: () => void;
  onSelect: (method: Method, service: Service, app: App) => void;
}

export function SearchPopup({ isOpen, apps, onClose, onSelect }: SearchPopupProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allMethods = useMemo(() => {
    const results: SearchResult[] = [];
    for (const app of apps) {
      for (const service of app.services) {
        for (const method of service.methods) {
          results.push({
            method,
            service,
            app,
            label: `${app.configuration.name} / ${service.name} / ${method.name}`,
          });
        }
      }
    }
    return results;
  }, [apps]);

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
          onSelect(result.method, result.service, result.app);
          onClose();
        }
      }
    },
    [filteredResults, selectedIndex, onClose, onSelect],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 pt-[15vh]" onClick={handleBackdropClick}>
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-background shadow-[0_8px_32px_rgba(0,0,0,0.24)]">
        <div className="p-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search size={16} />
            </span>
            <Input
              ref={inputRef}
              className="h-10 pl-9 text-base"
              placeholder={`Search methods (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}K)`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto border-t border-border">
          {filteredResults.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No methods found</div>
          ) : (
            filteredResults.map((result, index) => (
              <div
                key={index}
                className={cn("cursor-pointer border-l-2 px-3 py-2.5", index === selectedIndex ? "border-primary bg-accent" : "border-transparent")}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  onSelect(result.method, result.service, result.app);
                  onClose();
                }}
              >
                <div className="text-sm text-foreground">{result.method.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {result.app.configuration.name} / {result.service.name}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
