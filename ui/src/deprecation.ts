import ts from "typescript";

// The one sentence a deprecated method is met with, wherever it is met: the tree
// row's tooltip, the finder, and the comment over the generated call. It names who
// deprecated it, because the decision is the API's rather than Kaja's, and says that
// the call still goes out — which is the one thing a struck-through name leaves open,
// and the whole of what tells this apart from a method Kaja refuses.
export const DEPRECATION_NOTE = "Deprecated by the API. Kaja still calls it.";

// Whether a generated declaration carries @deprecated. It is the one channel every
// app says so on: `option deprecated = true` on an rpc and `deprecated: true` on an
// OpenAPI operation both reach the generated TypeScript as this tag, so nothing
// downstream has to ask which kind of app the method came from.
//
// Read off the comment text the way docText is, rather than through ts.getJSDocTags,
// which wants parent pointers the generated sources are not parsed with.
export function isDeprecated(node: ts.Node, file: ts.SourceFile): boolean {
  const fullText = file.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  return (ranges ?? []).some((range) => DEPRECATED_TAG.test(fullText.slice(range.pos, range.end)));
}

// The tag on a line of its own, past whatever comment decoration opens the line, so
// the word written inside a sentence is prose rather than a mark.
const DEPRECATED_TAG = /^[\s*/]*@deprecated\b/m;
