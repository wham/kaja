import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import * as React from "react";

import { cn } from "../../lib/utils";

const Switch = React.forwardRef<React.ElementRef<typeof BaseSwitch.Root>, React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>>(
  ({ className, ...props }, ref) => (
    <BaseSwitch.Root
      ref={ref}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0" />
    </BaseSwitch.Root>
  ),
);
Switch.displayName = "Switch";

export { Switch };
