import * as React from "react";

import { cn } from "../cn";

// Minimal stand-in for Primer's FormControl compound component: a labelled
// field with optional caption and validation message.
interface FormControlProps {
  className?: string;
  children: React.ReactNode;
}

function FormControl({ className, children }: FormControlProps) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

function Label({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-sm font-medium text-foreground", className)}>
      {children}
    </label>
  );
}

function Caption({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-xs text-muted-foreground", className)}>{children}</span>;
}

function Validation({ variant = "error", children, className }: { variant?: "error" | "success"; children: React.ReactNode; className?: string }) {
  return <span className={cn("text-xs", variant === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400", className)}>{children}</span>;
}

FormControl.Label = Label;
FormControl.Caption = Caption;
FormControl.Validation = Validation;

export { FormControl };
