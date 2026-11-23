import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";
import { Button, type ButtonProps } from "./button";

const widthClass = {
  sm: "max-w-sm",
  default: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export interface DialogFooterButton {
  content: React.ReactNode;
  onClick: () => void;
  variant?: ButtonProps["variant"];
  disabled?: boolean;
}

export interface DialogProps {
  title?: React.ReactNode;
  width?: keyof typeof widthClass;
  onClose: () => void;
  footerButtons?: DialogFooterButton[];
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const backdropClass = "fixed inset-0 z-50 bg-black/50 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";
const popupClass =
  "fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card shadow-lg transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0";
// Under 640px a dialog is a sheet standing on the keyboard, which is what `--keyboard-inset` measures.
const phonePopupClass =
  "max-sm:top-auto max-sm:bottom-[var(--keyboard-inset,0px)] max-sm:left-0 max-sm:max-h-[calc(100dvh-var(--keyboard-inset,0px)-env(safe-area-inset-top)-24px)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:gap-2 max-sm:overflow-y-auto max-sm:rounded-t-[14px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:duration-200 max-sm:data-[starting-style]:translate-y-full max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:opacity-100 max-sm:data-[ending-style]:translate-y-full max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:opacity-100";

// Open while mounted; closes through onClose.
function Dialog({ title, width = "default", onClose, footerButtons, initialFocusRef, children }: DialogProps) {
  return (
    <BaseDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdropClass} />
        <BaseDialog.Popup initialFocus={initialFocusRef} className={cn(popupClass, widthClass[width], phonePopupClass)}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3 max-sm:min-h-14 max-sm:border-b-0">
            <BaseDialog.Title className="text-sm font-semibold text-foreground max-sm:text-[17px]">{title}</BaseDialog.Title>
            <BaseDialog.Close className="rounded-sm text-muted-foreground max-sm:-mr-1 max-sm:flex max-sm:size-11 max-sm:items-center max-sm:justify-center max-sm:rounded-full max-sm:border max-sm:border-border max-sm:bg-background max-sm:text-foreground max-sm:opacity-100 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={16} />
              <span className="sr-only">Close</span>
            </BaseDialog.Close>
          </div>
          <div className="px-4 py-1">{children}</div>
          {footerButtons && footerButtons.length > 0 && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3 max-sm:border-t-0 max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:[&>button]:h-[50px] max-sm:[&>button]:flex-1 max-sm:[&>button]:rounded-xl max-sm:[&>button]:text-[17px]">
              {footerButtons.map((button, index) => (
                <Button key={index} variant={button.variant ?? "outline"} disabled={button.disabled} onClick={button.onClick}>
                  {button.content}
                </Button>
              ))}
            </div>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export { Dialog };
