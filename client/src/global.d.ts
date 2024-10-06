export {};
declare global {
  interface Window {
    kaja: Kaja;
    [key: string]: {};
  }
}

interface Kaja {
  onMethodCall: (serviceName: string, methodName: string, input: any, output: any) => void;
}
