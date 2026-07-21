import { Menu } from "@base-ui-components/react/menu";
import * as React from "react";

import { cn } from "../lib/utils";

const DropdownMenu = Menu.Root;
const DropdownMenuGroup = Menu.Group;

function DropdownMenuTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) {
    return <Menu.Trigger render={children as React.ReactElement<Record<string, unknown>>} {...props} />;
  }
  return <Menu.Trigger {...props}>{children}</Menu.Trigger>;
}

type Anchor = React.ComponentProps<typeof Menu.Positioner>["anchor"];

interface DropdownMenuContentProps extends React.ComponentPropsWithoutRef<typeof Menu.Popup> {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  anchor?: Anchor;
}

function DropdownMenuContent({ className, align = "center", side = "bottom", sideOffset = 4, anchor, children, ...props }: DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner className="z-50 outline-none" align={align} side={side} sideOffset={sideOffset} anchor={anchor}>
        <Menu.Popup
          className={cn(
            "min-w-[10rem] origin-[var(--transform-origin)] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

interface DropdownMenuItemProps extends Omit<React.ComponentPropsWithoutRef<typeof Menu.Item>, "onClick"> {
  variant?: "default" | "danger";
  onSelect?: () => void;
}

function DropdownMenuItem({ className, variant = "default", onSelect, ...props }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      onClick={() => onSelect?.()}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0",
        variant === "danger" && "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.GroupLabel>) {
  return <Menu.GroupLabel className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup };
