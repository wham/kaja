import { twMerge } from "tailwind-merge";

export type ClassValue = string | false | null | undefined;

export function cn(...inputs: ClassValue[]) {
  return twMerge(inputs.filter(Boolean).join(" "));
}

// Base UI lets `className` be a function of the part's state; keep that form
// intact while merging our own classes in.
export type StatefulClassName<S> = string | ((state: S) => string | undefined) | undefined;

export function cnState<S>(base: string, className: StatefulClassName<S>) {
  if (typeof className === "function") {
    return (state: S) => cn(base, className(state));
  }
  return cn(base, className);
}

type Variants = Record<string, Record<string, string>>;

type Selection<V extends Variants> = { [K in keyof V]?: keyof V[K] | null };

interface VariantSelector<V extends Variants> {
  (selection?: Selection<V> & { className?: ClassValue }): string;
}

export type VariantProps<T> = T extends VariantSelector<infer V> ? Selection<V> : never;

export function cva<V extends Variants>(base: string, configuration: { variants: V; defaultVariants?: Selection<V> }): VariantSelector<V> {
  return (selection) => {
    const classes: ClassValue[] = [base];
    for (const name of Object.keys(configuration.variants)) {
      const value = selection?.[name] ?? configuration.defaultVariants?.[name];
      if (value != null) {
        classes.push(configuration.variants[name][value as string]);
      }
    }
    classes.push(selection?.className);
    return classes.filter(Boolean).join(" ");
  };
}
