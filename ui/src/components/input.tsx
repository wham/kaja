import * as React from "react";

import { cn } from "../cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** What a field holding a name, an address or a credential asks of a phone's keyboard: nothing typed is prose. */
export const PLAIN_TEXT = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    {...PLAIN_TEXT}
    className={cn(
      "flex h-8 w-full max-sm:h-11 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
