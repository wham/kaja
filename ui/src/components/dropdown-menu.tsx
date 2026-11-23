import { Menu } from "@base-ui/react/menu";
import * as React from "react";

import { cn, cnState } from "../cn";

const DropdownMenu = Menu.Root;

function DropdownMenuTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) {
    return <Menu.Trigger render={children as React.ReactElement<Record<string, unknown>>} {...props} />;
  }
  return <Menu.Trigger {...props}>{children}</Menu.Trigger>;
}

const PHONE_SHEET =
  "max-sm:w-full max-sm:rounded-t-[14px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-2 max-sm:pt-2 max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:duration-200 max-sm:data-[starting-style]:translate-y-full max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:opacity-100 max-sm:data-[ending-style]:translate-y-full max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:opacity-100";

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
      <Menu.Backdrop className="fixed inset-0 z-50 bg-black/55 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 sm:hidden" />
      {/* Under 640px the menu is a sheet at the foot of the screen, so the anchored position Base UI writes inline is overridden. */}
      <Menu.Positioner
        className="z-50 outline-none max-sm:!fixed max-sm:!inset-x-0 max-sm:!top-auto max-sm:!bottom-0 max-sm:!transform-none"
        align={align}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <Menu.Popup
          className={cnState(
            cn(
              "min-w-[10rem] origin-[var(--transform-origin)] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              PHONE_SHEET,
            ),
            typeof className === "string" ? cn(className, "max-sm:w-full") : className,
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
      className={cnState(
        cn(
          "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 max-sm:min-h-[52px] max-sm:gap-3.5 max-sm:rounded-xl max-sm:px-4 max-sm:text-[17px] [&_svg]:shrink-0",
          variant === "danger" && "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
        ),
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cnState("-mx-1 my-1 h-px bg-border max-sm:mx-2", className)} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
