import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { App } from "./apps";
import { formatTypeScript, formatTypeScriptWithCursor } from "./formatter";
import { findTimestamps, timestampToDate, formatDateForDisplay } from "./timestampPicker";
import { TimestampPickerContentWidget } from "./TimestampPickerWidget";
import { kajaModuleDeclaration } from "./kajaModule";
import { codeFontSize } from "./monacoTheme";
import { claimedBindings, isMacPlatform, subscribeShortcuts } from "./shortcuts";
import { ScalarValue } from "./typeMemory";
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

/**
 * Every chord the window states is unbound in Monaco, because Monaco matches first
 * and then stops the event at the editor — ⌘⏎ ran Insert Line Below rather than the
 * script, and a rebind onto ⌘/ or ⌘D would go the same way. The rule is scoped to the
 * context the editor actions claim, so the same chord elsewhere in Monaco (⌘⏎ is
 * Replace All in the find widget) is left alone.
 *
 * Monaco's registry only takes rules, so a chord the window has claimed **this
 * session** stays out of its way even after being rebound away. Re-registering is
 * what a rebind costs; a reload is what settles it back to the configured set.
 */
function claimWindowKeys() {
  const rules = claimedBindings()
    .map(monacoKeybinding)
    .filter((keybinding): keybinding is number => keybinding !== undefined)
    .map((keybinding) => ({ keybinding, command: null, when: "editorTextFocus" }));
  if (rules.length > 0) monaco.editor.addKeybindingRules(rules);
}

const MONACO_MODIFIER: Record<string, number> = {
  Mod: monaco.KeyMod.CtrlCmd,
  // On a Mac this is the Ctrl key; off one, Mod and Ctrl are the same key and
  // WinCtrl is the Windows key, which no binding here means.
  Ctrl: isMacPlatform() ? monaco.KeyMod.WinCtrl : monaco.KeyMod.CtrlCmd,
  Alt: monaco.KeyMod.Alt,
  Shift: monaco.KeyMod.Shift,
};

const MONACO_NAMED_KEY: Record<string, number> = {
  Enter: monaco.KeyCode.Enter,
  Escape: monaco.KeyCode.Escape,
  Tab: monaco.KeyCode.Tab,
  Backspace: monaco.KeyCode.Backspace,
  Delete: monaco.KeyCode.Delete,
  Space: monaco.KeyCode.Space,
  Home: monaco.KeyCode.Home,
  End: monaco.KeyCode.End,
  PageUp: monaco.KeyCode.PageUp,
  PageDown: monaco.KeyCode.PageDown,
  ArrowUp: monaco.KeyCode.UpArrow,
  ArrowDown: monaco.KeyCode.DownArrow,
  ArrowLeft: monaco.KeyCode.LeftArrow,
  ArrowRight: monaco.KeyCode.RightArrow,
  // Monaco names the physical key where the window names the character that was
  // typed, so these agree on a US layout and are a best effort on any other. A chord
  // this cannot place is one Monaco is left holding, which is the state every chord
  // but ⌘⏎ was in before.
  ";": monaco.KeyCode.Semicolon,
  "=": monaco.KeyCode.Equal,
  ",": monaco.KeyCode.Comma,
  "-": monaco.KeyCode.Minus,
  ".": monaco.KeyCode.Period,
  "/": monaco.KeyCode.Slash,
  "`": monaco.KeyCode.Backquote,
  "[": monaco.KeyCode.BracketLeft,
  "\\": monaco.KeyCode.Backslash,
  "]": monaco.KeyCode.BracketRight,
  "'": monaco.KeyCode.Quote,
};

// A binding as Monaco says it. Undefined for a key it has no code for, which is a
// chord it was never going to match anyway.
function monacoKeybinding(binding: string): number | undefined {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  let keybinding = 0;
  for (const part of parts) {
    const modifier = MONACO_MODIFIER[part];
    if (modifier === undefined) return undefined;
    keybinding |= modifier;
  }

  const named = MONACO_NAMED_KEY[key];
  if (named !== undefined) return keybinding | named;
  if (/^[A-Z]$/.test(key)) return keybinding | (monaco.KeyCode.KeyA + key.charCodeAt(0) - "A".charCodeAt(0));
  if (/^[0-9]$/.test(key)) return keybinding | (monaco.KeyCode.Digit0 + key.charCodeAt(0) - "0".charCodeAt(0));
  const functionKey = /^F([1-9]|1[0-2])$/.exec(key);
  if (functionKey) return keybinding | (monaco.KeyCode.F1 + Number(functionKey[1]) - 1);
  return undefined;
}

claimWindowKeys();
subscribeShortcuts(claimWindowKeys);

monaco.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  // ModuleDetectionKind.Force, which monaco's typescript namespace doesn't export.
  // The task runner transpiles with it (scriptRunner), so without it here a script
  // with no import is a global script to the editor alone: top-level await is an
  // error in it, and its top-level names collide with every other such script.
  moduleDetection: 3,
});

// Scripts get the kaja object through `import { kaja } from "kaja"` — the task
// runner resolves the import at run time (see scriptRunner). Back the import with
// a model (not an extra lib) so autocomplete can auto-import it and
// go-to-definition lands here. Called again whenever the configured variables
// change (see App.tsx) to refresh the typed `variables` member.
export function registerKajaModule(variableNames: string[]): void {
  const content = kajaModuleDeclaration(variableNames);
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
          documentation: "The Kaja runtime object (kaja.table, kaja.text, kaja.askStr, kaja.variables, kaja.value).",
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

// The values a field takes are offered here rather than written into the
// generated request, so filling a field in stays a deliberate keystroke. An API
// that declares a closed set is where this earns its keep: the one string out of
// three it accepts is otherwise only in its documentation.
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

    const { typeName, fieldName } = suggested.position;
    const shortTypeName = typeName.slice(typeName.lastIndexOf(".") + 1);

    // The API's own values first: a document is a better answer than a guess read
    // off what happened to be sent before.
    const offered: { value: ScalarValue; detail: string }[] = [
      ...suggested.position.declared.map((value) => ({ value, detail: `${shortTypeName}.${fieldName} · declared by the API` })),
      ...suggested.values.map((remembered) => ({
        value: remembered.value,
        detail: `${remembered.typeName.slice(remembered.typeName.lastIndexOf(".") + 1)}.${remembered.fieldName} · ${remembered.origin === "request" ? "sent to" : "returned by"} ${remembered.method}`,
      })),
    ];

    return {
      suggestions: offered.map(({ value, detail }, index) => {
        const text = String(value);
        return {
          label: truncate(text),
          kind: monaco.languages.CompletionItemKind.Value,
          detail,
          insertText: stringRange ? escapeForStringLiteral(text) : JSON.stringify(value),
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
  /**
   * Whether to run the buffer through prettier as it is shown. Only a generated
   * module is: it is printed by the TypeScript printer, lives in memory and is
   * nobody's file. A script's buffer is never touched, because a script is a file
   * on disk and this editor auto-saves — reformatting it here would rewrite
   * somebody's file for the crime of being opened, in prettier's defaults rather
   * than in the settings the file was written under.
   */
  format?: boolean;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface onGoToDefinition {
  (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): void;
}

export function Editor({ model, onMount, onGoToDefinition, readOnly = false, format = false, startLineNumber = 0, startColumn = 0, viewState }: EditorProps) {
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
        fontSize: codeFontSize(),
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

    const goingTo = !viewState && startLineNumber > 0;

    if (format && goingTo) {
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
    } else if (format) {
      formatTypeScript(model.getValue()).then((formattedCode) => {
        if (!isDisposing && editorRef.current) {
          editorRef.current.setValue(formattedCode);
          if (viewState) {
            editorRef.current.restoreViewState(viewState);
          }
        }
      });
    } else {
      if (viewState) {
        editorRef.current.restoreViewState(viewState);
      } else if (goingTo) {
        editorRef.current.revealLineInCenter(startLineNumber);
        editorRef.current.setPosition({ lineNumber: startLineNumber, column: Math.max(startColumn, 1) });
      }
    }

    editorRef.current?.setModel(model);

    return () => {
      isDisposing = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [model]);

  // The option is read once, when the editor is created, and a view mounts before
  // the process has said whether it may write the workspace: a window restores its
  // views synchronously and the answer arrives with the configuration. Without this
  // the file that was open when the window last closed stays read-only for the
  // session, and reopening it revisits the same editor.
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div ref={containerRef} className="h-full w-full bg-background" />;
}
