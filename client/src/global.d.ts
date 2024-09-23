export {};
declare global {
  interface Window {
    setOutput?: (endpoint: string, output: string, isError: boolean) => void;
    [key: string]: {};
  }
}
