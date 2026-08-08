import type { EnumInfo, FieldInfo, IMessageType } from "@protobuf-ts/runtime";
import { ScalarType } from "@protobuf-ts/runtime";
import type { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { App, Service } from "./apps";
import { appType } from "./appTypes";
import { findInStub, Source } from "./sources";

// The catalog the MCP server answers list_services and describe_method from. It
// is facts only: what exists, what shape it has, and what the API said about it.
// How much of that to show, and whether a method reads or writes, is decided
// where the answer is written (desktop/mcp), so the two never disagree.
export interface McpCatalog {
  apps: McpApp[];
  // Every message type reachable from a method, keyed by its proto type name, so
  // a request type can be inlined without walking anything twice.
  types: { [typeName: string]: McpType };
  enums: { [typeName: string]: McpEnum };
  sources: McpSource[];
}

export interface McpApp {
  name: string;
  type: string;
  services: McpService[];
}

export interface McpService {
  name: string;
  packageName: string;
  // What a script imports the service from.
  importPath: string;
  methods: McpMethod[];
}

export interface McpMethod {
  name: string;
  input: string;
  output: string;
  // The HTTP request the method stands for, e.g. "GET /shows", when the app knows
  // one. Only apps that transcode HTTP set it.
  http?: string;
  serverStreaming?: boolean;
  clientStreaming?: boolean;
  doc?: string;
}

export interface McpType {
  name: string;
  // The TypeScript type a script writes for this message.
  ts: string;
  // The module the TypeScript name is exported from.
  importPath?: string;
  doc?: string;
  fields: McpField[];
}

export interface McpField {
  // The property name a script writes.
  name: string;
  kind: "scalar" | "message" | "enum" | "map";
  // "string", "int32", "map<string, Pet>", or a message/enum type name.
  type: string;
  repeated?: boolean;
  // The API declares the field required. Absent means unknown, not optional:
  // proto3 has no required, so only an app that knows its API's contract says so.
  required?: boolean;
  // Where an HTTP app carries the field: "path", "query" or "header".
  in?: string;
  // The oneof group the field belongs to. Members of a group are written under a
  // single `{ oneofKind, <member> }` property.
  oneof?: string;
  // The field exists only to carry an HTTP payload protobuf has no shape for.
  envelope?: boolean;
  doc?: string;
}

export interface McpEnum {
  name: string;
  ts: string;
  importPath?: string;
  values: string[];
}

export interface McpSource {
  path: string;
  content: string;
}

const HTTP_REQUEST_OPTION = "kaja.http_request";
const HTTP_IN_OPTION = "kaja.http_in";
const HTTP_REQUIRED_OPTION = "kaja.http_required";
const HTTP_PAYLOAD_OPTION = "kaja.http_payload";

// buildMcpCatalog turns the compiled apps into the catalog the MCP server serves.
// Only apps that compiled and expose services are listed, so a pending or failed
// one leaves the rest intact.
export function buildMcpCatalog(apps: App[]): McpCatalog {
  const catalog: McpCatalog = { apps: [], types: {}, enums: {}, sources: [] };

  for (const app of apps) {
    if (app.compilation.status !== "success" || app.services.length === 0) continue;

    const services: McpService[] = [];
    for (const service of app.services) {
      const source = app.sources.find((candidate) => candidate.importPath === service.sourcePath);
      if (!source) continue;
      const serviceInfo: ServiceInfo | undefined = findInStub(app.stub, source, service.name);
      if (!serviceInfo) continue;

      services.push({
        name: service.name,
        packageName: service.packageName,
        importPath: service.sourcePath,
        methods: serviceInfo.methods.map((methodInfo) => describeMethod(methodInfo, service, app.sources, catalog)),
      });
    }
    if (services.length === 0) continue;

    catalog.apps.push({ name: app.configuration.name, type: appType(app.configuration), services });
    for (const source of app.sources) {
      catalog.sources.push({ path: source.importPath, content: source.file.text });
    }
  }

  return catalog;
}

function describeMethod(methodInfo: MethodInfo, service: Service, sources: Source[], catalog: McpCatalog): McpMethod {
  collectType(methodInfo.I, sources, catalog);
  collectType(methodInfo.O, sources, catalog);

  const method: McpMethod = {
    name: methodInfo.name,
    input: methodInfo.I.typeName,
    output: methodInfo.O.typeName,
  };
  const http = stringOption(methodInfo.options, HTTP_REQUEST_OPTION);
  if (http) method.http = http;
  if (methodInfo.serverStreaming) method.serverStreaming = true;
  if (methodInfo.clientStreaming) method.clientStreaming = true;

  // The proto comment reaches the generated client interface as JSDoc on the
  // member protobuf-ts names in lowerCamelCase; the proto name is what the
  // catalog uses everywhere else.
  const doc = methodDoc(methodInfo.name, service, sources);
  if (doc) method.doc = doc;
  return method;
}

function methodDoc(methodName: string, service: Service, sources: Source[]): string | undefined {
  const clientSource = sources.find((candidate) => candidate.stubModuleId === service.clientStubModuleId);
  const docs = clientSource?.docs["I" + service.name + "Client"];
  if (!docs) return undefined;
  const member = Object.keys(docs.members).find((name) => name.toLowerCase() === methodName.toLowerCase());
  return member ? docs.members[member] : undefined;
}

// collectType records a message type and everything it reaches. Recursion stops
// on a type already recorded, which is also what makes a self-referential message
// terminate.
function collectType(message: IMessageType<any>, sources: Source[], catalog: McpCatalog): void {
  if (catalog.types[message.typeName]) return;

  const located = locate(sources, message);
  const type: McpType = {
    name: message.typeName,
    ts: located?.name ?? shortName(message.typeName),
    importPath: located?.source.importPath,
    fields: [],
  };
  // Recorded before the fields are walked, so a message that reaches itself stops.
  catalog.types[message.typeName] = type;

  const docs = located ? located.source.docs[located.name] : undefined;
  if (docs?.self) type.doc = docs.self;

  for (const field of message.fields) {
    type.fields.push(describeField(field, docs?.members[field.localName], sources, catalog));
  }
}

function describeField(field: FieldInfo, doc: string | undefined, sources: Source[], catalog: McpCatalog): McpField {
  const described: McpField = { name: field.localName, kind: field.kind, type: fieldType(field, sources, catalog) };
  if (field.repeat) described.repeated = true;
  if (field.oneof) described.oneof = field.oneof;
  if (boolOption(field.options, HTTP_REQUIRED_OPTION)) described.required = true;
  const location = stringOption(field.options, HTTP_IN_OPTION);
  if (location) described.in = location;
  if (field.options?.[HTTP_PAYLOAD_OPTION]) described.envelope = true;
  if (doc) described.doc = doc;
  return described;
}

function fieldType(field: FieldInfo, sources: Source[], catalog: McpCatalog): string {
  switch (field.kind) {
    case "scalar":
      return scalarName(field.T);
    case "enum":
      return collectEnum(field.T(), sources, catalog);
    case "message":
      collectType(field.T(), sources, catalog);
      return field.T().typeName;
    case "map":
      return `map<${scalarName(field.K)}, ${mapValueType(field.V, sources, catalog)}>`;
  }
}

// MapValue is the value half of a protobuf-ts map field.
type MapValue = { kind: "scalar"; T: ScalarType } | { kind: "enum"; T: () => EnumInfo } | { kind: "message"; T: () => IMessageType<any> };

function mapValueType(value: MapValue, sources: Source[], catalog: McpCatalog): string {
  switch (value.kind) {
    case "scalar":
      return scalarName(value.T);
    case "enum":
      return collectEnum(value.T(), sources, catalog);
    case "message":
      collectType(value.T(), sources, catalog);
      return value.T().typeName;
  }
}

// collectEnum records an enum's values and returns its type name. protobuf-ts
// carries an enum as [typeName, object, sharedPrefix?], where the object maps
// names to numbers and back.
function collectEnum(info: EnumInfo, sources: Source[], catalog: McpCatalog): string {
  const [typeName, object] = info;
  if (!catalog.enums[typeName]) {
    const values = Object.keys(object).filter((key) => typeof object[key] === "number");
    const located = locateEnum(sources, object);
    catalog.enums[typeName] = { name: typeName, ts: located?.name ?? shortName(typeName), importPath: located?.source.importPath, values };
  }
  return typeName;
}

// locate finds the source and declared name of a message type, which is both the
// TypeScript name a script writes and the key its doc comments are filed under.
function locate(sources: Source[], message: IMessageType<any>): { source: Source; name: string } | undefined {
  for (const source of sources) {
    const name = messageNameIn(source, message);
    if (name) return { source, name };
  }
  return undefined;
}

// messageNameIn returns the interface a source declares for a message type. The
// generated interface and the runtime MessageType share a name, so matching the
// proto type name against the declared interfaces is enough - and the interface
// is what carries the docs.
function messageNameIn(source: Source, message: IMessageType<any>): string | undefined {
  const short = shortName(message.typeName);
  if (source.interfaces[short]) return short;
  // A nested message is declared as Parent_Child in TypeScript.
  const nested = message.typeName.split(".").slice(-2).join("_");
  return source.interfaces[nested] ? nested : undefined;
}

function locateEnum(sources: Source[], object: any): { source: Source; name: string } | undefined {
  for (const source of sources) {
    for (const name of Object.keys(source.enums)) {
      if (source.enums[name].object === object) return { source, name };
    }
  }
  return undefined;
}

function shortName(typeName: string): string {
  return typeName.split(".").pop() ?? typeName;
}

function stringOption(options: { [key: string]: any } | undefined, key: string): string | undefined {
  const value = options?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function boolOption(options: { [key: string]: any } | undefined, key: string): boolean {
  return options?.[key] === true;
}

const scalarNames: { [key: number]: string } = {
  [ScalarType.DOUBLE]: "double",
  [ScalarType.FLOAT]: "float",
  [ScalarType.INT64]: "int64",
  [ScalarType.UINT64]: "uint64",
  [ScalarType.INT32]: "int32",
  [ScalarType.FIXED64]: "fixed64",
  [ScalarType.FIXED32]: "fixed32",
  [ScalarType.BOOL]: "bool",
  [ScalarType.STRING]: "string",
  [ScalarType.BYTES]: "bytes",
  [ScalarType.UINT32]: "uint32",
  [ScalarType.SFIXED32]: "sfixed32",
  [ScalarType.SFIXED64]: "sfixed64",
  [ScalarType.SINT32]: "sint32",
  [ScalarType.SINT64]: "sint64",
};

function scalarName(scalar: ScalarType): string {
  return scalarNames[scalar] ?? "string";
}
