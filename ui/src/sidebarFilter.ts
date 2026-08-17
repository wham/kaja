import { createContext, useContext } from "react";

/**
 * The sidebar's search, which belongs to the panel rather than to either section
 * in it.
 *
 * That is why it is passed as a context instead of a prop: the Scripts region is
 * handed to the sidebar as a node, because the two lists share nothing but the
 * panel — and the search is the one thing that now spans both, so the region
 * reads it from the panel rather than being told it by whoever assembled them.
 *
 * Hits travel back the other way so the field can state one number for a search
 * over two lists. The sidebar counts its own catalog; anything else reports what
 * it matched under a key of its own.
 */

export interface SidebarFilter {
  query: string;
  reportHits: (section: string, hits: number) => void;
}

const SidebarFilterContext = createContext<SidebarFilter>({ query: "", reportHits: () => {} });

export const SidebarFilterProvider = SidebarFilterContext.Provider;

export function useSidebarFilter(): SidebarFilter {
  return useContext(SidebarFilterContext);
}
