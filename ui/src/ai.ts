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
        range: new monaco.Range(position.lineNumber, position.column - prefix.length, position.lineNumber, position.column),
      },
    ];
  } catch (error) {
    console.error("Error fetching AI completions:", error);
    return [];
  }
}

export function registerAIProvider(githubToken: string) {
  monaco.languages.registerCompletionItemProvider("typescript", {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model, position, context) => {
      const completionContext: CompletionContext = {
        prefix: model.getWordUntilPosition(position).word,
        position,
        model,
      };

      const suggestions = await fetchAICompletions(githubToken, completionContext);

      return {
        suggestions: suggestions.map((suggestion) => ({
          label: suggestion.text,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: suggestion.text,
          range: suggestion.range,
          detail: "AI suggestion",
          sortText: "0",
        })),
      };
    },
  });
}
