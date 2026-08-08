import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { App } from "./apps";
import { formatTypeScript, formatTypeScriptWithCursor } from "./formatter";
import { findTimestamps, timestampToDate, formatDateForDisplay } from "./timestampPicker";
import { TimestampPickerContentWidget } from "./TimestampPickerWidget";
import { suggestValues } from "./valueCompletions";

self.MonacoEnvironment = {
  getWorkerUrl: function (_, label) {
    if (label === "typescript" || label === "javascript") {
      return "./monaco.ts.worker.js";
    }
    if (label === "json") {
      return "./monaco.json.worker.js";
    }
    return "./monaco.editor.worker.js";
  },
};

monaco.languages.registerDocumentFormattingEditProvider("typescript", {
  async provideDocumentFormattingEdits(model: monaco.editor.ITextModel) {
    return [
      {
        text: await formatTypeScript(model.getValue()),
        range: model.getFullModelRange(),
      },
    ];
  },
});

// ⌘⏎ runs the script, and the shortcut lives on the window (see App.tsx). Monaco
// binds the same chord to Insert Line Below and, having matched it, stops the
// event at the editor — so inside the editor the key wrote a line instead of
// running. Unbind it here, scoped to the same context the editor action claims,
// so the chord goes unmatched and reaches the window while ⌘⏎ elsewhere in
// Monaco (Replace All in the find widget) is left alone.
monaco.editor.addKeybindingRule({
  keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
  command: null,
  when: "editorTextFocus",
});

monaco.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
});

// Build the `variables` member type from the configured names so the editor
// suggests them and flags typos. With names it is an exact object; with none it
// falls back to an index signature so `kaja.variables.foo` isn't flagged before
// any variable exists.
function kajaVariablesType(variableNames: string[]): string {
  if (variableNames.length === 0) {
    return "{ [key: string]: string }";
  }
  const members = variableNames.map((name) => `    ${JSON.stringify(name)}: string;`).join("\n");
  return `{\n${members}\n  }`;
}

// Scripts get the kaja object through `import { kaja } from "kaja"` — the task
// runner resolves the import at run time (see taskRunner). Back the import with
// a model (not an extra lib) so autocomplete can auto-import it and
// go-to-definition lands here. Called again whenever the configured variables
// change (see App.tsx) to refresh the typed `variables` member.
export function registerKajaModule(variableNames: string[]): void {
  const content = `/** A plain JSON value, as accepted by kaja.value and friends. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** google.protobuf.Value. */
export interface Value {
  kind:
    | { oneofKind: "nullValue"; nullValue: 0 }
    | { oneofKind: "numberValue"; numberValue: number }
    | { oneofKind: "stringValue"; stringValue: string }
    | { oneofKind: "boolValue"; boolValue: boolean }
    | { oneofKind: "structValue"; structValue: Struct }
    | { oneofKind: "listValue"; listValue: ListValue };
}

/** google.protobuf.Struct. */
export interface Struct {
  fields: { [key: string]: Value };
}

/** google.protobuf.ListValue. */
export interface ListValue {
  values: Value[];
}

/** The Kaja runtime object. Import it with: import { kaja } from "kaja"; */
export declare const kaja: {
  /**
   * The selected text passed in when the script is launched from the macOS
   * "Run Kaja Script" text service. Undefined when the script is run manually
   * from the editor, so guard with a fallback (e.g. kaja.input ?? "").
   */
  input?: string;
  /**
   * User-defined variables. Manage them in the Variables tab; read them here,
   * e.g. kaja.variables.API_BASE_URL. A variable whose value this machine holds
   * (your keychain, or an environment variable) reads the same way.
   */
  variables: ${kajaVariablesType(variableNames)};
  /**
   * Pause the script and ask the user for input. The question is drawn on the
   * run's canvas and the run stops there until it is answered. Resolves with
   * the submitted text; if the user cancels, the script stops.
   *
   *   const name = await kaja.ask("What's your name?");
   */
  ask(message: string): Promise<string>;
  /**
   * Write a line onto the run's canvas.
   *
   *   kaja.text(\`Reconciling \${accounts.length} accounts\`);
   */
  text(text: string): void;
  /**
   * Put a snippet of code on the run's canvas.
   *
   *   kaja.code(query, "sql");
   */
  code(code: string, language?: string): void;
  /**
   * Start a table on the run's canvas and hand back a handle to fill it. Rows
   * appear as they are added, so a loop paints rather than reporting at the end.
   *
   *   const table = kaja.table(["id", "name", "status"]);
   *   for (const account of accounts) {
   *     table.row(account.id, account.name, await check(account));
   *   }
   */
  table(columns: string[], rows?: unknown[][]): { row(...cells: unknown[]): void };
  /** UUID helpers. */
  uuid: {
    /**
     * Generate a random version 4 UUID, e.g. "9b2b1a94-3c6e-4f6e-9d2a-0f6b7c8d9e0f".
     *
     *   const id = kaja.uuid.v4();
     */
    v4(): string;
  };
  /**
   * Build a google.protobuf.Value from a plain JSON value, instead of writing
   * its oneof out by hand. Objects and arrays are converted all the way down.
   *
   *   kaja.value("ready");
   *   kaja.value({ retries: 3, tags: ["a", "b"] });
   */
  value(input: JsonValue): Value;
  /**
   * Build a google.protobuf.Struct from a plain object.
   *
   *   kaja.struct({ region: "eu", replicas: 2 });
   */
  struct(input: { [key: string]: JsonValue }): Struct;
  /**
   * Build a google.protobuf.ListValue from a plain array.
   *
   *   kaja.listValue(["a", 1, true]);
   */
  listValue(input: JsonValue[]): ListValue;
};
`;
  const uri = monaco.Uri.parse("ts:/kaja.ts");
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    existing.setValue(content);
  } else {
    monaco.editor.createModel(content, "typescript", uri);
  }
}

registerKajaModule([]);

const KAJA_IMPORT_COMMAND = "kaja.addImport";
const KAJA_IMPORT_LINE = 'import { kaja } from "kaja";\n';

function hasKajaImport(text: string): boolean {
  return /from\s+["']kaja["']/.test(text);
}

// The import is inserted from a command rather than as the completion's
// `additionalTextEdits`: Monaco places the cursor from the main edit alone, so
// an edit that adds a line above it leaves the cursor a line behind the word it
// just completed. Here the edit and the selection it moves are applied together.
monaco.editor.registerCommand(KAJA_IMPORT_COMMAND, (_accessor, modelUri: string) => {
  const model = monaco.editor.getModel(monaco.Uri.parse(modelUri));
  if (!model || hasKajaImport(model.getValue())) {
    return;
  }

  const edit = { range: new monaco.Range(1, 1, 1, 1), text: KAJA_IMPORT_LINE };
  const editor = monaco.editor.getEditors().find((candidate) => candidate.getModel() === model);
  if (!editor) {
    model.pushEditOperations(null, [edit], () => null);
    return;
  }

  const selections = editor.getSelections() ?? [];
  editor.executeEdits(
    KAJA_IMPORT_COMMAND,
    [edit],
    selections.map(
      (selection) =>
        new monaco.Selection(
          selection.selectionStartLineNumber + 1,
          selection.selectionStartColumn,
          selection.positionLineNumber + 1,
          selection.positionColumn,
        ),
    ),
  );
});

// Monaco's TypeScript worker doesn't auto-import from other models, so offer
// `kaja` as a completion that also inserts the import when it's missing.
monaco.languages.registerCompletionItemProvider("typescript", {
  provideCompletionItems(model, position) {
    if (model.uri.path === "/kaja.ts" || hasKajaImport(model.getValue())) {
      return { suggestions: [] };
    }
    const word = model.getWordUntilPosition(position);
    return {
      suggestions: [
        {
          label: { label: "kaja", description: 'import from "kaja"' },
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: 'Add import from "kaja"',
          documentation: "The Kaja runtime object (kaja.input, kaja.variables, kaja.ask, kaja.value).",
          insertText: "kaja",
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          command: { id: KAJA_IMPORT_COMMAND, title: 'Add import from "kaja"', arguments: [model.uri.toString()] },
        },
      ],
    };
  },
});

// Apps the value completions resolve service names against. Kept in sync from
// App.tsx as apps compile.
let valueCompletionApps: App[] = [];

export function setValueCompletionApps(apps: App[]): void {
  valueCompletionApps = apps;
}

function truncate(text: string): string {
  return text.length > 60 ? text.slice(0, 59) + "…" : text;
}

// Escape a value so it survives being dropped between quotes, whichever quote
// style the literal under the cursor uses.
function escapeForStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

// Values from earlier calls are offered here rather than written into the
// generated request, so filling a field in stays a deliberate keystroke.
monaco.languages.registerCompletionItemProvider("typescript", {
  triggerCharacters: ['"', "'", ":", " "],
  provideCompletionItems(model, position) {
    if (valueCompletionApps.length === 0) {
      return { suggestions: [] };
    }

    const suggested = suggestValues(model.getValue(), model.getOffsetAt(position), valueCompletionApps);
    if (!suggested) {
      return { suggestions: [] };
    }

    const stringRange = suggested.position.stringRange;
    let range: monaco.Range;
    if (stringRange) {
      const start = model.getPositionAt(stringRange.start);
      const end = model.getPositionAt(stringRange.end);
      range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    } else {
      const word = model.getWordUntilPosition(position);
      range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    }

    return {
      suggestions: suggested.values.map((remembered, index) => {
        const text = String(remembered.value);
        const typeName = remembered.typeName.slice(remembered.typeName.lastIndexOf(".") + 1);
        return {
          label: truncate(text),
          kind: monaco.languages.CompletionItemKind.Value,
          detail: `${typeName}.${remembered.fieldName} · ${remembered.origin === "request" ? "sent to" : "returned by"} ${remembered.method}`,
          insertText: stringRange ? escapeForStringLiteral(text) : JSON.stringify(remembered.value),
          filterText: text,
          sortText: String(index).padStart(3, "0"),
          range,
        };
      }),
    };
  },
});

const TIMESTAMP_PICKER_COMMAND = "kaja.pickTimestamp";
let timestampCommandRegistered = false;
let activeTimestampWidget: TimestampPickerContentWidget | null = null;
let activeWidgetEditor: monaco.editor.IStandaloneCodeEditor | null = null;

function registerTimestampCommand() {
  if (timestampCommandRegistered) return;

  monaco.editor.registerCommand(
    TIMESTAMP_PICKER_COMMAND,
    (_accessor, editorId: string, range: monaco.Range, fullRange: monaco.Range, fieldName: string, seconds: string, nanos: number) => {
      const editors = monaco.editor.getEditors();
      const codeEditor = editors.find((e) => e.getId() === editorId);
      if (!codeEditor) return;

      const editor = codeEditor as monaco.editor.IStandaloneCodeEditor;

      if (activeTimestampWidget && activeWidgetEditor) {
        activeWidgetEditor.removeContentWidget(activeTimestampWidget);
        activeTimestampWidget.dispose();
        activeTimestampWidget = null;
        activeWidgetEditor = null;
      }

      const widget = new TimestampPickerContentWidget(editor, range, fullRange, fieldName, seconds, nanos, () => {
        if (activeTimestampWidget && activeWidgetEditor) {
          activeWidgetEditor.removeContentWidget(activeTimestampWidget);
          activeTimestampWidget.dispose();
          activeTimestampWidget = null;
          activeWidgetEditor = null;
        }
      });

      editor.addContentWidget(widget);
      activeTimestampWidget = widget;
      activeWidgetEditor = editor;
    },
  );

  // Use a cached Code Lens provider that minimizes blink on updates
  let cachedLenses: Map<string, monaco.languages.CodeLens[]> = new Map();

  monaco.languages.registerCodeLensProvider("typescript", {
    provideCodeLenses: (model) => {
      const modelId = model.uri.toString();
      const timestamps = findTimestamps(model);
      const editors = monaco.editor.getEditors();
      const editor = editors.find((e) => e.getModel() === model);
      const editorId = editor?.getId() ?? "";

      const lenses: monaco.languages.CodeLens[] = timestamps.map((ts) => {
        const date = timestampToDate(ts.seconds, ts.nanos);
        const displayDate = formatDateForDisplay(date);

        return {
          range: ts.range,
          command: {
            id: TIMESTAMP_PICKER_COMMAND,
            title: `📅 ${displayDate}`,
            arguments: [editorId, ts.range, ts.fullRange, ts.fieldName, ts.seconds, ts.nanos],
          },
        };
      });

      cachedLenses.set(modelId, lenses);
      return { lenses, dispose: () => {} };
    },
  });

  timestampCommandRegistered = true;
}

registerTimestampCommand();

interface EditorProps {
  model: monaco.editor.ITextModel;
  readOnly?: boolean;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface onGoToDefinition {
  (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): void;
}

export function Editor({ model, onMount, onGoToDefinition, readOnly = false, startLineNumber = 0, startColumn = 0, viewState }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let isDisposing = false;

    if (!editorRef.current) {
      editorRef.current = monaco.editor.create(containerRef.current, {
        model,
        language: "typescript",
        automaticLayout: true,
        padding: {
          top: 16,
          bottom: 16,
        },
        minimap: {
          enabled: false,
        },
        // The pane is deliberately short so the response gets the room. Vertical
        // scrolling is the cost of that; horizontal scrolling would be worse, so
        // a line too long to fit wraps instead.
        wordWrap: "on",
        readOnly,
        fixedOverflowWidgets: true,
        renderLineHighlight: "none",
        formatOnPaste: true,
        formatOnType: true,
        tabSize: 2,
        inlineSuggest: {
          enabled: true,
          mode: "subwordSmart",
          showToolbar: "always",
        },
        quickSuggestions: {
          other: "inline",
          comments: "inline",
          strings: "inline",
        },
        suggest: {
          preview: true,
          showInlineDetails: true,
          showMethods: true,
          showFunctions: true,
          showVariables: true,
          showConstants: true,
          showConstructors: true,
          showFields: true,
          showFiles: true,
        },
      });

      const editorService = (editorRef.current as any)._codeEditorService;
      editorService.openCodeEditor = async (input: { resource: monaco.Uri; options?: { selection?: { startLineNumber: number; startColumn: number } } }) => {
        const model = monaco.editor.getModel(input.resource);
        if (model) {
          let startLineNumber = 0;
          let startColumn = 0;
          if (input.options?.selection) {
            startLineNumber = input.options.selection.startLineNumber;
            startColumn = input.options.selection.startColumn;
          }
          onGoToDefinition(model, startLineNumber, startColumn);
        }
      };

      onMount?.(editorRef.current);
    }

    if (!viewState && startLineNumber > 0) {
      // startLineNumber/startColumn were resolved against the unformatted model
      // text; formatting reflows lines, so remap the position through prettier.
      const cursorOffset = model.getOffsetAt({ lineNumber: startLineNumber, column: Math.max(startColumn, 1) });
      formatTypeScriptWithCursor(model.getValue(), cursorOffset).then((result) => {
        if (!isDisposing && editorRef.current) {
          editorRef.current.setValue(result.code);
          const position = model.getPositionAt(result.cursorOffset);
          editorRef.current.revealLineInCenter(position.lineNumber);
          editorRef.current.setPosition(position);
        }
      });
    } else {
      formatTypeScript(model.getValue()).then((formattedCode) => {
        if (!isDisposing && editorRef.current) {
          editorRef.current.setValue(formattedCode);
          if (viewState) {
            editorRef.current.restoreViewState(viewState);
          }
        }
      });
    }

    editorRef.current?.setModel(model);

    return () => {
      isDisposing = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [model]);

  return <div ref={containerRef} className="h-full w-full bg-background" />;
}
