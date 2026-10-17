import { EnumInfo, MessageType, PartialFieldInfo } from "@protobuf-ts/runtime";
import { ServiceType } from "@protobuf-ts/runtime-rpc";
import type { FieldManifest, ModuleManifest } from "./sources";

export type EnumObject = EnumInfo[1];

// The types an app's calls are made with, built from the field descriptors its
// manifest carries rather than from generated code: the runtime drives create and the
// binary codec off exactly these, so nothing of an app is ever evaluated.
export interface Reflection {
  messages: Map<string, MessageType<any>>;
  enums: Map<string, EnumObject>;
  services: Map<string, ServiceType>;
}

export function emptyReflection(): Reflection {
  return { messages: new Map(), enums: new Map(), services: new Map() };
}

export function buildReflection(modules: ModuleManifest[]): Reflection {
  const reflection = emptyReflection();
  const enumInfos = new Map<string, EnumInfo>();

  for (const module of modules) {
    for (const e of module.enums) {
      // A TypeScript enum: the name maps to the number and the number back to the
      // name, the last of several aliases winning, as the declaration reads.
      const object: { [key: string]: string | number } = {};
      for (const [name, number] of e.values) {
        object[name] = number;
        object[number] = name;
      }
      const enumObject = object as EnumObject;
      reflection.enums.set(e.typeName, enumObject);
      enumInfos.set(e.typeName, e.prefix ? [e.typeName, enumObject, e.prefix] : [e.typeName, enumObject]);
    }
  }

  const message = (typeName: string): MessageType<any> => {
    const type = reflection.messages.get(typeName);
    if (!type) throw new Error(`The app declares no message ${typeName}`);
    return type;
  };
  const enumInfo = (typeName: string): EnumInfo => {
    const info = enumInfos.get(typeName);
    if (!info) throw new Error(`The app declares no enum ${typeName}`);
    return info;
  };
  // A type is reached through a function so a message can name one built after it,
  // itself included.
  const typeOf = (kind: string, typeName: string) => (kind === "message" ? () => message(typeName) : () => enumInfo(typeName));

  const fieldInfo = (field: FieldManifest): PartialFieldInfo => {
    const { T, V, ...rest } = field;
    switch (field.kind) {
      case "scalar":
        return { ...rest, T } as PartialFieldInfo;
      case "map":
        return { ...rest, V: V!.kind === "scalar" ? V : { kind: V!.kind, T: typeOf(V!.kind, V!.T as string) } } as PartialFieldInfo;
      default:
        return { ...rest, T: typeOf(field.kind, T as string) } as PartialFieldInfo;
    }
  };

  for (const module of modules) {
    for (const msg of module.messages) {
      reflection.messages.set(msg.typeName, new MessageType(msg.typeName, msg.fields.map(fieldInfo), msg.options));
    }
  }

  for (const module of modules) {
    for (const service of module.services) {
      const methods = service.methods.map((method) => ({
        name: method.name,
        localName: method.localName,
        idempotency: method.idempotency,
        serverStreaming: method.serverStreaming,
        clientStreaming: method.clientStreaming,
        options: method.options ?? {},
        I: message(method.I),
        O: message(method.O),
      }));
      reflection.services.set(service.typeName, new ServiceType(service.typeName, methods, service.options));
    }
  }

  return reflection;
}
