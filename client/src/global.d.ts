export {};
declare global {
  interface Window {
    setOutput?: (output: string) => void;
    [key: string]: {};
  }
}
