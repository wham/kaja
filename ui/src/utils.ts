// Utility functions for the UI

// Check if we're running in Wails environment
export function isWailsEnvironment(): boolean {
  return typeof window !== 'undefined' && (window as any).go !== undefined;
}