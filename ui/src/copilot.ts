import * as monaco from "monaco-editor";

interface CopilotSuggestion {
  text: string;
  range: monaco.Range;
}

interface CopilotCompletionContext {
  triggerKind: monaco.languages.CompletionTriggerKind;
  prefix: string;
  position: monaco.Position;
  model: monaco.editor.ITextModel;
}

async function fetchCopilotSuggestions(githubToken: string, context: CopilotCompletionContext): Promise<CopilotSuggestion[]> {
  const fileContent = context.model.getValue();
  const position = context.position;
  const lineContent = context.model.getLineContent(position.lineNumber);
  const prefix = lineContent.substring(0, position.column - 1);

  try {
    const response = await fetch("https://api.github.com/copilot/suggest", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: fileContent,
        position: {
          line: position.lineNumber - 1,
          character: position.column - 1,
        },
        prefix,
        language: "typescript",
      }),
    });

    if (!response.ok) {
      console.error("Failed to fetch Copilot suggestions:", await response.text());
      return [];
    }

    const suggestions = await response.json();
    return suggestions.map((suggestion: any) => ({
      text: suggestion.text,
      range: new monaco.Range(position.lineNumber, position.column - prefix.length, position.lineNumber, position.column),
    }));
  } catch (error) {
    console.error("Error fetching Copilot suggestions:", error);
    return [];
  }
}

export function registerCopilotProvider(githubToken: string) {
  monaco.languages.registerCompletionItemProvider("typescript", {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model, position, context) => {
      const copilotContext: CopilotCompletionContext = {
        triggerKind: context.triggerKind,
        prefix: model.getWordUntilPosition(position).word,
        position,
        model,
      };

      const suggestions = await fetchCopilotSuggestions(githubToken, copilotContext);

      return {
        suggestions: suggestions.map((suggestion) => ({
          label: suggestion.text,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: suggestion.text,
          range: suggestion.range,
          detail: "GitHub Copilot suggestion",
          sortText: "0",
        })),
      };
    },
  });
}
