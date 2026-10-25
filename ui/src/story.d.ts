// A story is a script Kaja ships, bundled as its text and never evaluated as a module.
// It is not `.ts` because TypeScript would compile what it imports, and a story imports
// an app no build of Kaja has.
declare module "*.story" {
  const text: string;
  export default text;
}
