import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "../../lib/utils";
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

// Primer-compatible ConfirmationDialog over Radix AlertDialog.
function ConfirmationDialog({
  title,
  confirmButtonContent,
  cancelButtonContent = "Cancel",
  confirmButtonType = "primary",
  onClose,
  children,
}: ConfirmationDialogProps) {
  return (
    <AlertDialogPrimitive.Root open onOpenChange={(open) => !open && onClose("cancel")}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-4 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <AlertDialogPrimitive.Title className="text-base font-semibold text-foreground">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description asChild>
            <div className="text-sm text-muted-foreground">{children}</div>
          </AlertDialogPrimitive.Description>
          <div className="flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "outline" }))}>{cancelButtonContent}</AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(buttonVariants({ variant: confirmButtonType === "danger" ? "destructive" : "default" }))}
              onClick={() => onClose("confirm")}
            >
              {confirmButtonContent}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export { ConfirmationDialog };
