import * as monaco from "monaco-editor";
import OpenAI from "openai";

interface AICompletion {
  text: string;
  range: monaco.Range;
}

interface CompletionContext {
  prefix: string;
  position: monaco.Position;
  model: monaco.editor.ITextModel;
}

const endpoint = "https://models.inference.ai.azure.com";
const modelName = "gpt-4o";
const DEBOUNCE_DELAY = 1000; // 1 second delay

let debounceTimer: NodeJS.Timeout | null = null;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests

async function debouncedFetchAICompletions(githubToken: string, context: CompletionContext): Promise<AICompletion[]> {
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
      const completions = await fetchAICompletions(githubToken, context);
      resolve(completions);
    }, DEBOUNCE_DELAY);
  });
}

async function fetchAICompletions(githubToken: string, context: CompletionContext): Promise<AICompletion[]> {
  const fileContent = context.model.getValue();
  const position = context.position;
  const lineContent = context.model.getLineContent(position.lineNumber);
  const prefix = lineContent.substring(0, position.column - 1);

  try {
    const client = new OpenAI({ baseURL: endpoint, apiKey: githubToken, dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful code completion assistant. Provide concise code completions based on the context.",
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

    const suggestion = response.choices[0].message.content;

    if (!suggestion) return [];

    return [
      {
        text: suggestion,
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
      },
    ];
  } catch (error) {
    console.error("Error fetching AI completions:", error);
    return [];
  }
}

export function registerAIProvider(githubToken: string) {
  monaco.languages.registerInlineCompletionsProvider("typescript", {
    provideInlineCompletions: async (model, position, context, token) => {
      const completionContext: CompletionContext = {
        prefix: model.getWordUntilPosition(position).word,
        position,
        model,
      };

      const suggestions = await debouncedFetchAICompletions(githubToken, completionContext);

      return {
        items: suggestions.map((suggestion) => ({
          insertText: suggestion.text,
          range: suggestion.range,
        })),
        enableForwardStability: true,
      };
    },
    freeInlineCompletions: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  });
}
