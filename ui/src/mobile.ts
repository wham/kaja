import { useMediaQuery } from "./useMediaQuery";

/**
 * There is one breakpoint, and above it nothing changes: the desktop frame with its
 * splitters is what an iPad in landscape gets too. Below it two panes side by side
 * would each be half of nothing, and there is no pointer to aim a splitter with — so
 * the window becomes one column that scrolls, and the splitters are gone rather than
 * shrunk.
 */
export const MOBILE_BREAKPOINT = 640;

export function useMobileFrame(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * What a finger has to hit. Every row and every control in the narrow frame is this
 * tall — a 24px call row and a 26px button are a pointer's sizes, and the log is the
 * one surface where they are also the sizes everything else is measured against.
 */
export const TOUCH_TARGET = 44;

/** The header, which is what the sidebar header, the command row and the status bar became. */
export const MOBILE_HEADER_HEIGHT = 52;

/**
 * A table row as the narrow frame reads it: the first column says what the row is and
 * the rest say what is known about it. Four columns in 390px is four truncations, so
 * the columns after the first become one caption and the row keeps its title whole.
 */
export function rowTitle(cells: string[]): string {
  return cells[0] ?? "";
}

export function rowCaption(cells: string[]): string {
  return cells
    .slice(1)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "")
    .join(" · ");
}

export interface RecordField {
  column: string;
  value: string;
  /** Where the value sits in the row, which is what a cell's status and destination are keyed by. */
  index: number;
}

/**
 * The whole row as key and value, which is what a tap opens. It is as long as the
 * wider of the two, so a row with more cells than the table has columns still states
 * every value it carries rather than dropping the ones nothing named.
 */
export function rowRecord(columns: string[], cells: string[]): RecordField[] {
  const width = Math.max(columns.length, cells.length);
  const fields: RecordField[] = [];
  for (let index = 0; index < width; index++) {
    fields.push({ column: columns[index] ?? "", value: cells[index] ?? "", index });
  }
  return fields;
}
