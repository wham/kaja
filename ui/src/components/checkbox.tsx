import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";

const Checkbox = React.forwardRef<React.ElementRef<typeof BaseCheckbox.Root>, React.ComponentPropsWithoutRef<typeof BaseCheckbox.Root>>(
  ({ className, ...props }, ref) => (
    <BaseCheckbox.Root
      ref={ref}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3.5 w-3.5" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
