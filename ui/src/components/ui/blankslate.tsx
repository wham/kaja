import * as React from "react";

import { cn } from "../../lib/utils";

function Blankslate({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-12 text-center", className)}>{children}</div>;
}

function Visual({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-muted-foreground">{children}</div>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-foreground">{children}</h2>;
}

function Description({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function PrimaryAction({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

Blankslate.Visual = Visual;
Blankslate.Heading = Heading;
Blankslate.Description = Description;
Blankslate.PrimaryAction = PrimaryAction;

export { Blankslate };
