import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

const Select = BaseSelect.Root;
const SelectGroup = BaseSelect.Group;

function SelectValue(props: React.ComponentProps<typeof BaseSelect.Value>) {
  return <BaseSelect.Value {...props} />;
}

const SelectTrigger = React.forwardRef<React.ElementRef<typeof BaseSelect.Trigger>, React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <BaseSelect.Trigger
      ref={ref}
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  ),
);
SelectTrigger.displayName = "SelectTrigger";

function SelectContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner className="z-50 outline-none" sideOffset={4}>
        <BaseSelect.Popup
          className={cn(
            "max-h-96 min-w-[8rem] origin-[var(--transform-origin)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>) {
  return <BaseSelect.GroupLabel className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...props} />;
}

interface SelectItemProps extends React.ComponentPropsWithoutRef<typeof BaseSelect.Item> {
  value: string;
}

function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <BaseSelect.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <Check className="h-4 w-4" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem };
