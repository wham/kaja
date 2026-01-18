import * as monaco from "monaco-editor";
import { Project } from "./project";
import { getApiClient } from "./server/connection";

interface AICompletion {
  text: string;
  range: monaco.Range;
}

interface CompletionContext {
  prefix: string;
  position: monaco.Position;
  model: monaco.editor.ITextModel;
}

const modelName = "gpt-4o-mini";
const DEBOUNCE_DELAY = 1000;

let debounceTimer: NodeJS.Timeout | null = null;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;

let isCompletionsDisabled = false;

interface ServiceInfo {
  serviceName: string;
  methods: string[];
}

function extractServiceInfo(projects: Project[]): ServiceInfo[] {
  const services: ServiceInfo[] = [];

  for (const project of projects) {
    for (const service of project.services) {
      services.push({
        serviceName: service.name,
        methods: service.methods.map((m) => m.name),
      });
    }
  }

  return services;
}

function generateSystemPrompt(projects: Project[]): string {
  const services = extractServiceInfo(projects);

  const apiReference = services
    .map((s) => {
      const methods = s.methods.map((m) => `  - ${m}(request): Promise<Response>`).join("\n");
      return `${s.serviceName}:\n${methods}`;
    })
    .join("\n\n");

  const protoSummary = projects
    .map((project) => {
      return project.sources
        .map((source) => {
          return `// ${source.path}\n${source.file.text}`;
        })
        .join("\n\n");
    })
    .join("\n\n---\n\n");

  return `You are a TypeScript code completion engine for gRPC/Twirp client code.

CRITICAL RULES:
- Output ONLY the code to insert at the cursor position
- NO explanations, NO markdown, NO comments about the code
- Match the existing code style exactly
- Use async/await for all RPC calls
- Import types from the generated client modules

AVAILABLE SERVICE METHODS:
${apiReference}

GENERATED TYPESCRIPT DEFINITIONS (for field reference):
${protoSummary}

Remember: Output ONLY the completion code, nothing else.`;
}

function buildFocusedContext(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): { beforeCursor: string; afterCursor: string; currentLine: string } {
  const lineCount = model.getLineCount();
  const startLine = Math.max(1, position.lineNumber - 30);
  const endLine = Math.min(lineCount, position.lineNumber + 5);

  const beforeCursor = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const afterCursor = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine),
  });

  const currentLine = model.getLineContent(position.lineNumber);

  return { beforeCursor, afterCursor, currentLine };
}

function extractCompletion(response: string): string {
  let completion = response;

  // Strip markdown code block markers if present
  completion = completion.replace(/^```(?:typescript|ts|javascript|js)?\n?/m, "");
  completion = completion.replace(/\n?```$/m, "");

  // If response starts with explanation text, try to extract just the code
  if (completion.match(/^(Here|This|The|I'll|Let me|To |You can|Based on)/i)) {
    // Look for code in backticks
    const inlineCodeMatch = completion.match(/`([^`]+)`/);
    if (inlineCodeMatch) {
      return inlineCodeMatch[1].trim();
    }

    // Look for a line that starts with code-like patterns
    const lines = completion.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.match(/^(const |let |var |await |return |if |for |while |function |async |import |export |class )/) ||
        trimmed.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[(.=]/)
      ) {
        return trimmed;
      }
    }
  }

  return completion.trim();
}

async function debouncedFetchAICompletions(context: CompletionContext, projects: Project[]): Promise<AICompletion[]> {
  return new Promise((resolve) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      resolve([]);
      return;
    }

    debounceTimer = setTimeout(async () => {
      lastRequestTime = Date.now();
      const completions = await fetchAICompletions(context, projects);
      resolve(completions);
    }, DEBOUNCE_DELAY);
  });
}

async function fetchAICompletions(context: CompletionContext, projects: Project[]): Promise<AICompletion[]> {
  const position = context.position;
  const { beforeCursor, afterCursor, currentLine } = buildFocusedContext(context.model, position);

  const prefix = currentLine.substring(0, position.column - 1).trim();

  try {
    const client = getApiClient();

    const userMessage = `Complete the TypeScript code at <CURSOR>. Output ONLY the completion code.

<code_before_cursor>
${beforeCursor}
</code_before_cursor><CURSOR><code_after_cursor>
${afterCursor}
</code_after_cursor>

Current line prefix: "${prefix}"`;

    const response = await client.chatCompletions({
      model: modelName,
      messages: [
        {
          role: "system",
          content: generateSystemPrompt(projects),
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.1,
      topP: 0.95,
      maxTokens: 200,
      stop: ["```", "\n\n\n", "Note:", "Here's"],
    });

    if (response.response.error) {
      if (response.response.error.includes("not configured")) {
        isCompletionsDisabled = true;
        console.info("Completions disabled: AI not configured");
      } else {
        console.error("AI completion error:", response.response.error);
      }
      return [];
    }

    if (!response.response.choices || response.response.choices.length === 0) {
      return [];
    }

    let suggestion = response.response.choices[0].message?.content;
    if (!suggestion) return [];

    suggestion = extractCompletion(suggestion);

    if (!suggestion) return [];

    return [
      {
        text: suggestion,
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
      },
    ];
  } catch (error: unknown) {
    console.error("Error fetching AI completions:", error);
    return [];
  }
}

let registeredProvider: monaco.IDisposable | null = null;

export function registerAIProvider(projects: Project[]) {
  if (registeredProvider) {
    registeredProvider.dispose();
  }

  registeredProvider = monaco.languages.registerInlineCompletionsProvider("typescript", {
    provideInlineCompletions: async (model, position, context, token) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const prefix = lineContent.substring(0, position.column - 1).trim();
      if (!prefix || prefix.length < 2) {
        return { items: [], enableForwardStability: true };
      }

      if (isCompletionsDisabled) {
        return { items: [], enableForwardStability: true };
      }

      const completionContext: CompletionContext = {
        prefix: model.getWordUntilPosition(position).word,
        position,
        model,
      };

      const suggestions = await debouncedFetchAICompletions(completionContext, projects);

      if (!suggestions.length || !suggestions[0].text.trim()) {
        return { items: [], enableForwardStability: true };
      }

      return {
        items: suggestions.map((suggestion) => ({
          insertText: suggestion.text.trim(),
          range: suggestion.range,
        })),
        enableForwardStability: true,
      };
    },
    disposeInlineCompletions: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  });
}
