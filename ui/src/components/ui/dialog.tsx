import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";
import { Button } from "./button";

const widthClass: Record<string, string> = {
  small: "max-w-sm",
  medium: "max-w-md",
  large: "max-w-2xl",
  xlarge: "max-w-4xl",
};

export interface DialogFooterButton {
  content: React.ReactNode;
  onClick: () => void;
  buttonType?: "primary" | "danger" | "normal";
}

export interface DialogProps {
  title?: React.ReactNode;
  width?: "small" | "medium" | "large" | "xlarge";
  onClose: () => void;
  footerButtons?: DialogFooterButton[];
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

// Primer-compatible Dialog: always open while mounted (the parent controls
// mounting via conditional rendering), closing through onClose.
function Dialog({ title, width = "medium", onClose, footerButtons, initialFocusRef, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            if (initialFocusRef?.current) {
              e.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-0 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            widthClass[width],
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="text-sm font-semibold text-foreground">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={16} />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <div className="px-4 py-1">{children}</div>
          {footerButtons && footerButtons.length > 0 && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              {footerButtons.map((button, index) => (
                <Button
                  key={index}
                  variant={button.buttonType === "primary" ? "default" : button.buttonType === "danger" ? "destructive" : "outline"}
                  onClick={button.onClick}
                >
                  {button.content}
                </Button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { Dialog };
