/**
 * Check if the application is running in a Wails environment
 */
export function isWailsEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  // Check for Wails runtime and Go bindings
  const hasRuntime = typeof (window as any).runtime !== 'undefined';
  const hasGoBindings = typeof (window as any).go?.main?.App !== 'undefined';
  
  return hasRuntime && hasGoBindings;
}