import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
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

const backdropClass = "fixed inset-0 z-50 bg-black/50 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";
const popupClass =
  "fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card shadow-lg transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0";

// Primer-compatible Dialog: open while mounted, closing through onClose.
function Dialog({ title, width = "medium", onClose, footerButtons, initialFocusRef, children }: DialogProps) {
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
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export { Dialog };
