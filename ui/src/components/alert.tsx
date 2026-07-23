import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../cn";

const alertVariants = cva("rounded-md border px-4 py-3 text-sm shadow-sm", {
  variants: {
    variant: {
      default: "border-border bg-card text-card-foreground",
      success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      danger: "border-destructive/40 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

export { Alert, alertVariants };
