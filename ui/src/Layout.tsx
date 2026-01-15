import React from "react";

/**
 * Layout components for consistent flex-based layouts.
 *
 * Strategy:
 * - Root uses position:fixed to escape any parent constraints
 * - All containers use display:flex with proper overflow handling
 * - "fill" containers expand to fill available space
 * - "scroll" containers handle overflow with scrolling
 */

const baseStyle: React.CSSProperties = {
  display: "flex",
  minWidth: 0,
  minHeight: 0,
};

interface LayoutProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/** Root layout - fixed position covering the viewport */
export function LayoutRoot({ children, style, className }: LayoutProps) {
  return (
    <div
      className={className}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        ...baseStyle,
        flexDirection: "row",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal layout (row) - fills parent by default */
export function LayoutRow({ children, style, className }: LayoutProps) {
  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        flex: 1,
        flexDirection: "row",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Vertical layout (column) - fills parent by default */
export function LayoutColumn({ children, style, className }: LayoutProps) {
  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        flex: 1,
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Scrollable vertical container */
export function LayoutScroll({ children, style, className }: LayoutProps) {
  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        flex: 1,
        flexDirection: "column",
        overflowY: "auto",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Fixed-size container (does not grow/shrink) */
export function LayoutFixed({ children, style, className }: LayoutProps) {
  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        flex: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
