import * as monaco from "monaco-editor";
import OpenAI from "openai";
import { Project } from "./project";
import { getBaseUrlForAi } from "./server/connection";
import { isWailsEnvironment } from "./wails";
interface AICompletion {
  text: string;
  range: monaco.Range;
}

interface CompletionContext {
  prefix: string;
  position: monaco.Position;
  model: monaco.editor.ITextModel;
}

const modelName = "gpt-4o";
const DEBOUNCE_DELAY = 1000; // 1 second delay

let debounceTimer: NodeJS.Timeout | null = null;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests

let isCompletionsDisabled = false;

// Function to generate system prompt with available services and methods
function generateSystemPrompt(projects: Project[]): string {
  const servicesList = projects
    .map((project) => {
      const projectSources = project.sources
        .map((source) => {
          return `  ${source.path}:\n${source.file.text}`;
        })
        .join("\n\n");
      return `${project.configuration.name}:\n${projectSources}`;
    })
    .join("\n\n");

  return `You are a helpful code completion assistant. Provide concise code completions based on the context.

Here are the files that are available for import:

${servicesList}

Tips for code completion:
1. Use async/await for API calls
2. Check response fields before using them
3. Handle pagination when needed
4. Specify positions for index calls
5. Use proper error handling

Provide suggestions that match the available API methods and follow TypeScript best practices.`;
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
  if (isWailsEnvironment()) {
    // In desktop mode, AI functionality might not be available or needs different configuration
    console.info("AI completions not available in desktop mode");
    return [];
  }

  const fileContent = context.model.getValue();
  const position = context.position;
  const lineContent = context.model.getLineContent(position.lineNumber);
  const prefix = lineContent.substring(0, position.column - 1);

  try {
    const client = new OpenAI({ baseURL: getBaseUrlForAi(), apiKey: "*****", dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: generateSystemPrompt(projects),
        },
        {
          role: "user",
          content: `Complete the following code:\n\n${fileContent}\n\nCurrent position: Line ${position.lineNumber}, Column ${position.column}\nPrefix: ${prefix}`,
        },
      ],
      temperature: 0.7,
      top_p: 1.0,
      max_tokens: 150,
      model: modelName,
    });

    let suggestion = response.choices[0].message.content;
    if (!suggestion) return [];

    // Strip markdown code block markers if present
    suggestion = suggestion
      .replace(/^```(?:typescript)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    return [
      {
        text: suggestion,
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
      },
    ];
  } catch (error: any) {
    // Check if the error is due to missing AI configuration and disable further completions
    if (error.message && error.message.includes("400")) {
      isCompletionsDisabled = true;
      console.info("Completions disabled: AI not configured");
    } else {
      console.error("Error fetching AI completions:", error);
    }

    return [];
  }
}

// Keep track of registered providers to clean up
let registeredProvider: monaco.IDisposable | null = null;

export function registerAIProvider(projects: Project[]) {
  // Clean up previous provider if it exists
  if (registeredProvider) {
    registeredProvider.dispose();
  }

  registeredProvider = monaco.languages.registerInlineCompletionsProvider("typescript", {
    provideInlineCompletions: async (model, position, context, token) => {
      // Don't trigger on empty lines or very short prefixes
      const lineContent = model.getLineContent(position.lineNumber);
      const prefix = lineContent.substring(0, position.column - 1).trim();
      if (!prefix || prefix.length < 2) {
        return { items: [], enableForwardStability: true };
      }

      // Skip completions if disabled
      if (isCompletionsDisabled) {
        return { items: [], enableForwardStability: true };
      }

      const completionContext: CompletionContext = {
        prefix: model.getWordUntilPosition(position).word,
        position,
        model,
      };

      const suggestions = await debouncedFetchAICompletions(completionContext, projects);

      // Ensure suggestions are not empty and have content
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
