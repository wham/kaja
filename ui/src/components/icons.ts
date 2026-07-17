// Central icon map. The UI was built against @primer/octicons-react; these
// re-exports keep the octicon names so consumers only swap their import path.
// Names on the left are the octicon identifiers used throughout the UI.
import {
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  Columns2 as ColumnsIcon,
  Copy as CopyIcon,
  Cpu as CpuIcon,
  Ellipsis as EllipsisIcon,
  File as FileIcon,
  FileCode as FileCodeIcon,
  Folder as FileDirectoryIcon,
  FlaskConical as BeakerIcon,
  FoldVertical as FoldIcon,
  Globe as GlobeIcon,
  Lightbulb as LightBulbIcon,
  MoreHorizontal as KebabHorizontalIcon,
  Moon as MoonIcon,
  Package as PackageIcon,
  PanelLeftClose as SidebarCollapseIcon,
  PanelLeftOpen as SidebarExpandIcon,
  Pencil as PencilIcon,
  Pin as PinIcon,
  Play as PlayIcon,
  Plug as PlugIcon,
  Plus as PlusIcon,
  Rocket as RocketIcon,
  Rows2 as RowsIcon,
  Search as SearchIcon,
  Server as ServerIcon,
  SlidersHorizontal as SlidersIcon,
  Sparkles as SparkleFillIcon,
  Sun as SunIcon,
  FileText as MarkdownIcon,
  Trash2 as TrashIcon,
  UnfoldVertical as UnfoldIcon,
  MessagesSquare as CommentDiscussionIcon,
  X as XIcon,
} from "lucide-react";
import { createElement, type ComponentType, type SVGProps } from "react";

// A component that renders an icon. Deliberately permissive: it accepts a
// numeric `size` only, which both lucide icons and (during the Primer→shadcn
// migration) octicons satisfy, so mixed call sites keep type-checking.
export type Icon = ComponentType<{ size?: number }>;

// lucide dropped brand icons; provide the GitHub mark inline.
export const MarkGithubIcon = (props: SVGProps<SVGSVGElement> & { size?: number | string }) => {
  const { size = 16, ...rest } = props;
  return createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true, ...rest },
    createElement("path", {
      d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
    }),
  );
};

export {
  BeakerIcon,
  CheckIcon,
  ChevronRightIcon,
  ColumnsIcon,
  CommentDiscussionIcon,
  CopyIcon,
  CpuIcon,
  EllipsisIcon,
  FileCodeIcon,
  FileDirectoryIcon,
  FileIcon,
  FoldIcon,
  GlobeIcon,
  KebabHorizontalIcon,
  LightBulbIcon,
  MarkdownIcon,
  MoonIcon,
  PackageIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  RocketIcon,
  RowsIcon,
  SearchIcon,
  ServerIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SlidersIcon,
  SparkleFillIcon,
  SunIcon,
  TrashIcon,
  UnfoldIcon,
  XIcon,
};
