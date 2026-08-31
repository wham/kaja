import { describe, it, expect, beforeEach } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import ts from "typescript";
import { App } from "./apps";
import { clearTypeMemory, rememberValues } from "./typeMemory";
import { resolveValuePosition, suggestValues } from "./valueCompletions";

function messageType(typeName: string, fields: any[]): IMessageType<any> {
  return {
    typeName,
    fields: fields.map((field, index) => ({ no: index + 1, localName: field.name, ...field })),
  } as unknown as IMessageType<any>;
}

const genre = messageType("movies.v1.Genre", [{ name: "name", kind: "scalar", T: ScalarType.STRING }]);

const movie = messageType("movies.v1.Movie", [
  { name: "id", kind: "scalar", T: ScalarType.STRING },
  { name: "year", kind: "scalar", T: ScalarType.INT32 },
  { name: "genre", kind: "message", T: () => genre },
  { name: "labels", kind: "map", K: ScalarType.STRING, V: { kind: "scalar", T: ScalarType.STRING } },
]);

const getMovieRequest = messageType("movies.v1.GetMovieRequest", [{ name: "id", kind: "scalar", T: ScalarType.STRING }]);

// The app said this field takes one of three words, the way an OpenAPI app carries
// a document's enum.
const findMoviesRequest = messageType("movies.v1.FindMoviesRequest", [
  { name: "status", kind: "scalar", T: ScalarType.STRING, options: { "kaja.enum_values": ["available", "pending", "sold"] } },
]);

const saveMovieRequest = messageType("movies.v1.SaveMovieRequest", [{ name: "movie", kind: "message", T: () => movie }]);

// An app exposing MoviesService.GetMovie and MoviesService.SaveMovie, shaped
// the way loadApp builds one.
function moviesApp(): App {
  const path = "demo/proto/movies.ts";
  return {
    stub: {
      demo$proto$movies: {
        MoviesService: {
          typeName: "movies.v1.Movies",
          methods: [
            { name: "GetMovie", I: getMovieRequest, O: movie },
            { name: "SaveMovie", I: saveMovieRequest, O: movie },
            { name: "FindMovies", I: findMoviesRequest, O: movie },
          ],
        },
      },
    },
    sources: [
      {
        path,
        importPath: "demo/proto/movies",
        stubModuleId: "demo$proto$movies",
        file: ts.createSourceFile(path, "", ts.ScriptTarget.Latest),
        serviceNames: ["MoviesService"],
        interfaces: {},
        enums: {},
      },
    ],
  } as unknown as App;
}

const imports = `import { MoviesService } from "demo/proto/movies";\n\n`;

// Split code at the | marking the cursor, into the code without it and its offset.
function atMarker(code: string): { code: string; offset: number } {
  const offset = code.indexOf("|");
  return { code: code.slice(0, offset) + code.slice(offset + 1), offset };
}

function resolveAt(marked: string, apps: App[] = [moviesApp()]) {
  const { code, offset } = atMarker(marked);
  return resolveValuePosition(code, offset, apps);
}

describe("resolveValuePosition", () => {
  it("resolves a scalar field inside a string literal", () => {
    const position = resolveAt(`${imports}MoviesService.GetMovie({ id: "|" });`);

    expect(position?.typeName).toBe("movies.v1.GetMovieRequest");
    expect(position?.fieldName).toBe("id");
    expect(position?.scalarType).toBe(ScalarType.STRING);
    expect(position?.stringRange).toBeDefined();
  });

  it("resolves a number field outside a string literal", () => {
    const position = resolveAt(`${imports}MoviesService.SaveMovie({ movie: { year: 0| } });`);

    expect(position?.typeName).toBe("movies.v1.Movie");
    expect(position?.fieldName).toBe("year");
    expect(position?.scalarType).toBe(ScalarType.INT32);
    expect(position?.stringRange).toBeUndefined();
  });

  it("resolves a field of a nested message", () => {
    const position = resolveAt(`${imports}MoviesService.SaveMovie({ movie: { genre: { name: "|" } } });`);

    expect(position?.typeName).toBe("movies.v1.Genre");
    expect(position?.fieldName).toBe("name");
  });

  it("resolves a map value to the map field", () => {
    const position = resolveAt(`${imports}MoviesService.SaveMovie({ movie: { labels: { key: "|" } } });`);

    expect(position?.typeName).toBe("movies.v1.Movie");
    expect(position?.fieldName).toBe("labels");
    expect(position?.scalarType).toBe(ScalarType.STRING);
  });

  it("reads the values the app declared for the field", () => {
    const position = resolveAt(`${imports}MoviesService.FindMovies({ status: "|" });`);

    expect(position?.declared).toEqual(["available", "pending", "sold"]);
  });

  it("declares nothing for a field the app said nothing about", () => {
    expect(resolveAt(`${imports}MoviesService.GetMovie({ id: "|" });`)?.declared).toEqual([]);
  });

  it("ignores the property name side", () => {
    expect(resolveAt(`${imports}MoviesService.GetMovie({ i|d: "" });`)).toBeUndefined();
  });

  it("ignores a field that is not a scalar", () => {
    expect(resolveAt(`${imports}MoviesService.SaveMovie({ movie: {| } });`)).toBeUndefined();
  });

  it("ignores calls to an unknown service", () => {
    expect(resolveAt(`${imports}OtherService.GetMovie({ id: "|" });`)).toBeUndefined();
  });

  it("ignores a service imported from another app", () => {
    const code = `import { MoviesService } from "other/proto/movies";\n\nMoviesService.GetMovie({ id: "|" });`;
    expect(resolveAt(code)).toBeUndefined();
  });

  it("resolves a service without an import, as scripts may write it", () => {
    const position = resolveAt(`MoviesService.GetMovie({ id: "|" });`);
    expect(position?.fieldName).toBe("id");
  });
});

describe("suggestValues", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  function suggestAt(marked: string) {
    const { code, offset } = atMarker(marked);
    return suggestValues(code, offset, [moviesApp()]);
  }

  it("offers nothing when nothing has been called yet", () => {
    expect(suggestAt(`${imports}MoviesService.GetMovie({ id: "|" });`)).toBeUndefined();
  });

  it("offers the ids a response came back with", () => {
    rememberValues("movies.v1.Movie", { id: "movie-7" }, movie, { method: "MoviesService.ListMovies", origin: "response" });

    const suggested = suggestAt(`${imports}MoviesService.GetMovie({ id: "|" });`);

    expect(suggested?.values.map((value) => value.value)).toEqual(["movie-7"]);
    expect(suggested?.values[0].origin).toBe("response");
    expect(suggested?.values[0].typeName).toBe("movies.v1.Movie");
  });

  it("offers the values the API declares before anything has been called", () => {
    const suggested = suggestAt(`${imports}MoviesService.FindMovies({ status: "|" });`);

    expect(suggested?.position.declared).toEqual(["available", "pending", "sold"]);
    expect(suggested?.values).toEqual([]);
  });

  it("leaves a declared value to the API rather than offering it twice", () => {
    rememberValues("movies.v1.FindMoviesRequest", { status: "pending" }, findMoviesRequest, { method: "MoviesService.FindMovies", origin: "request" });

    const suggested = suggestAt(`${imports}MoviesService.FindMovies({ status: "|" });`);

    expect(suggested?.position.declared).toEqual(["available", "pending", "sold"]);
    expect(suggested?.values).toEqual([]);
  });

  it("puts what was sent to this exact field first", () => {
    rememberValues("movies.v1.Movie", { id: "from-response" }, movie, { method: "MoviesService.ListMovies", origin: "response" });
    rememberValues("movies.v1.GetMovieRequest", { id: "from-request" }, getMovieRequest, { method: "MoviesService.GetMovie", origin: "request" });

    const suggested = suggestAt(`${imports}MoviesService.GetMovie({ id: "|" });`);

    expect(suggested?.values.map((value) => value.value)).toEqual(["from-request", "from-response"]);
  });
});
