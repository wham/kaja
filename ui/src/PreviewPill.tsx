// The mark an experimental feature wears wherever it is named — a sidebar row,
// an entry in the New dialog. It sits beside the surfaces that use it rather
// than in `components/` because it is not a design-system primitive.
export function PreviewPill() {
  return <span className="ml-1.5 rounded bg-accent px-[5px] py-px text-[9px] font-bold text-accent-foreground">Preview</span>;
}
