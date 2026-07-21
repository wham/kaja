import { AlertDialog } from "@base-ui-components/react/alert-dialog";
import * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";

export type ConfirmationGesture = "confirm" | "cancel";

export interface ConfirmationDialogProps {
  title: React.ReactNode;
  confirmButtonContent: React.ReactNode;
  cancelButtonContent?: React.ReactNode;
  confirmButtonType?: "primary" | "danger";
  onClose: (gesture: ConfirmationGesture) => void;
  children: React.ReactNode;
}

function ConfirmationDialog({
  title,
  confirmButtonContent,
  cancelButtonContent = "Cancel",
  confirmButtonType = "primary",
  onClose,
  children,
}: ConfirmationDialogProps) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose("cancel")}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-4 shadow-lg transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
          <AlertDialog.Title className="text-base font-semibold text-foreground">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">{children}</AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Close className={cn(buttonVariants({ variant: "outline" }))}>{cancelButtonContent}</AlertDialog.Close>
            <button className={cn(buttonVariants({ variant: confirmButtonType === "danger" ? "destructive" : "default" }))} onClick={() => onClose("confirm")}>
              {confirmButtonContent}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export { ConfirmationDialog };
