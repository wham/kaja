// Written by the build (tsLibs in server/internal/ui/builder.go): each standard library
// file TypeScript checks against, by file name.
declare module "kaja:typescript-libs" {
  const libs: { [fileName: string]: string };
  export default libs;
}
