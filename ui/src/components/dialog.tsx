import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";
import { Button, type ButtonProps } from "./button";

const widthClass = {
  sm: "max-w-sm",
  default: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export interface DialogFooterButton {
  content: React.ReactNode;
  onClick: () => void;
  variant?: ButtonProps["variant"];
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

// Open while mounted; closes through onClose.
function Dialog({ title, width = "default", onClose, footerButtons, initialFocusRef, children }: DialogProps) {
  return (
    <BaseDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdropClass} />
        <BaseDialog.Popup initialFocus={initialFocusRef} className={cn(popupClass, widthClass[width])}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <BaseDialog.Title className="text-sm font-semibold text-foreground">{title}</BaseDialog.Title>
            <BaseDialog.Close className="rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={16} />
              <span className="sr-only">Close</span>
            </BaseDialog.Close>
          </div>
          <div className="px-4 py-1">{children}</div>
          {footerButtons && footerButtons.length > 0 && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              {footerButtons.map((button, index) => (
                <Button key={index} variant={button.variant ?? "outline"} onClick={button.onClick}>
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
