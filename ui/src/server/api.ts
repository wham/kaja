// @generated by protobuf-ts 2.9.4 with parameter generate_dependencies
// @generated from protobuf file "api.proto" (syntax proto3)
// tslint:disable
import { ServiceType } from "@protobuf-ts/runtime-rpc";
import type { BinaryWriteOptions } from "@protobuf-ts/runtime";
import type { IBinaryWriter } from "@protobuf-ts/runtime";
import { WireType } from "@protobuf-ts/runtime";
import type { BinaryReadOptions } from "@protobuf-ts/runtime";
import type { IBinaryReader } from "@protobuf-ts/runtime";
import { UnknownFieldHandler } from "@protobuf-ts/runtime";
import type { PartialMessage } from "@protobuf-ts/runtime";
import { reflectionMergePartial } from "@protobuf-ts/runtime";
import { MessageType } from "@protobuf-ts/runtime";
/**
 * @generated from protobuf message CompileRequest
 */
export interface CompileRequest {
  /**
   * @generated from protobuf field: int32 log_offset = 1;
   */
  logOffset: number;
  /**
   * @generated from protobuf field: bool force = 2;
   */
  force: boolean;
  /**
   * @generated from protobuf field: string project_name = 3;
   */
  projectName: string;
  /**
   * @generated from protobuf field: string workspace = 4;
   */
  workspace: string;
}
/**
 * @generated from protobuf message CompileResponse
 */
export interface CompileResponse {
  /**
   * @generated from protobuf field: CompileStatus status = 1;
   */
  status: CompileStatus;
  /**
   * @generated from protobuf field: repeated Log logs = 2;
   */
  logs: Log[];
  /**
   * @generated from protobuf field: repeated string sources = 3;
   */
  sources: string[];
}
/**
 * @generated from protobuf message Log
 */
export interface Log {
  /**
   * @generated from protobuf field: LogLevel level = 1;
   */
  level: LogLevel;
  /**
   * @generated from protobuf field: string message = 2;
   */
  message: string;
}
/**
 * @generated from protobuf message GetConfigurationRequest
 */
export interface GetConfigurationRequest {}
/**
 * @generated from protobuf message GetConfigurationResponse
 */
export interface GetConfigurationResponse {
  /**
   * @generated from protobuf field: Configuration configuration = 1;
   */
  configuration?: Configuration;
  /**
   * @generated from protobuf field: repeated Log logs = 2;
   */
  logs: Log[];
}
/**
 * @generated from protobuf message Configuration
 */
export interface Configuration {
  /**
   * kaja can be deployed at a subpath - i.e. kaja.tools/demo
   * This field is used to set the subpath.
   * The server uses it to generate the correct paths in HTML and redirects.
   * The JS code is using relative paths and should be not dependent on this.
   *
   * @generated from protobuf field: string path_prefix = 1;
   */
  pathPrefix: string;
  /**
   * @generated from protobuf field: repeated ConfigurationProject projects = 2;
   */
  projects: ConfigurationProject[];
  /**
   * @generated from protobuf field: ConfigurationAI ai = 3;
   */
  ai?: ConfigurationAI;
}
/**
 * @generated from protobuf message ConfigurationProject
 */
export interface ConfigurationProject {
  /**
   * @generated from protobuf field: string name = 1;
   */
  name: string;
  /**
   * @generated from protobuf field: RpcProtocol protocol = 2;
   */
  protocol: RpcProtocol;
  /**
   * @generated from protobuf field: string url = 3;
   */
  url: string;
  /**
   * @generated from protobuf field: string workspace = 4;
   */
  workspace: string;
}
/**
 * @generated from protobuf message ConfigurationAI
 */
export interface ConfigurationAI {
  /**
   * @generated from protobuf field: string base_url = 1;
   */
  baseUrl: string;
  /**
   * @generated from protobuf field: string api_key = 2;
   */
  apiKey: string;
}
/**
 * @generated from protobuf enum CompileStatus
 */
export enum CompileStatus {
  /**
   * @generated from protobuf enum value: STATUS_UNKNOWN = 0;
   */
  STATUS_UNKNOWN = 0,
  /**
   * @generated from protobuf enum value: STATUS_READY = 1;
   */
  STATUS_READY = 1,
  /**
   * @generated from protobuf enum value: STATUS_ERROR = 2;
   */
  STATUS_ERROR = 2,
  /**
   * @generated from protobuf enum value: STATUS_RUNNING = 3;
   */
  STATUS_RUNNING = 3,
}
/**
 * @generated from protobuf enum LogLevel
 */
export enum LogLevel {
  /**
   * @generated from protobuf enum value: LEVEL_DEBUG = 0;
   */
  LEVEL_DEBUG = 0,
  /**
   * @generated from protobuf enum value: LEVEL_INFO = 1;
   */
  LEVEL_INFO = 1,
  /**
   * @generated from protobuf enum value: LEVEL_WARN = 2;
   */
  LEVEL_WARN = 2,
  /**
   * @generated from protobuf enum value: LEVEL_ERROR = 3;
   */
  LEVEL_ERROR = 3,
}
/**
 * @generated from protobuf enum RpcProtocol
 */
export enum RpcProtocol {
  /**
   * @generated from protobuf enum value: RPC_PROTOCOL_TWIRP = 0;
   */
  TWIRP = 0,
  /**
   * @generated from protobuf enum value: RPC_PROTOCOL_GRPC = 1;
   */
  GRPC = 1,
}
// @generated message type with reflection information, may provide speed optimized methods
class CompileRequest$Type extends MessageType<CompileRequest> {
  constructor() {
    super("CompileRequest", [
      { no: 1, name: "log_offset", kind: "scalar", T: 5 /*ScalarType.INT32*/ },
      { no: 2, name: "force", kind: "scalar", T: 8 /*ScalarType.BOOL*/ },
      { no: 3, name: "project_name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 4, name: "workspace", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value?: PartialMessage<CompileRequest>): CompileRequest {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.logOffset = 0;
    message.force = false;
    message.projectName = "";
    message.workspace = "";
    if (value !== undefined) reflectionMergePartial<CompileRequest>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: CompileRequest): CompileRequest {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* int32 log_offset */ 1:
          message.logOffset = reader.int32();
          break;
        case /* bool force */ 2:
          message.force = reader.bool();
          break;
        case /* string project_name */ 3:
          message.projectName = reader.string();
          break;
        case /* string workspace */ 4:
          message.workspace = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: CompileRequest, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* int32 log_offset = 1; */
    if (message.logOffset !== 0) writer.tag(1, WireType.Varint).int32(message.logOffset);
    /* bool force = 2; */
    if (message.force !== false) writer.tag(2, WireType.Varint).bool(message.force);
    /* string project_name = 3; */
    if (message.projectName !== "") writer.tag(3, WireType.LengthDelimited).string(message.projectName);
    /* string workspace = 4; */
    if (message.workspace !== "") writer.tag(4, WireType.LengthDelimited).string(message.workspace);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message CompileRequest
 */
export const CompileRequest = new CompileRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class CompileResponse$Type extends MessageType<CompileResponse> {
  constructor() {
    super("CompileResponse", [
      { no: 1, name: "status", kind: "enum", T: () => ["CompileStatus", CompileStatus] },
      { no: 2, name: "logs", kind: "message", repeat: 1 /*RepeatType.PACKED*/, T: () => Log },
      { no: 3, name: "sources", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value?: PartialMessage<CompileResponse>): CompileResponse {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.status = 0;
    message.logs = [];
    message.sources = [];
    if (value !== undefined) reflectionMergePartial<CompileResponse>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: CompileResponse): CompileResponse {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* CompileStatus status */ 1:
          message.status = reader.int32();
          break;
        case /* repeated Log logs */ 2:
          message.logs.push(Log.internalBinaryRead(reader, reader.uint32(), options));
          break;
        case /* repeated string sources */ 3:
          message.sources.push(reader.string());
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: CompileResponse, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* CompileStatus status = 1; */
    if (message.status !== 0) writer.tag(1, WireType.Varint).int32(message.status);
    /* repeated Log logs = 2; */
    for (let i = 0; i < message.logs.length; i++) Log.internalBinaryWrite(message.logs[i], writer.tag(2, WireType.LengthDelimited).fork(), options).join();
    /* repeated string sources = 3; */
    for (let i = 0; i < message.sources.length; i++) writer.tag(3, WireType.LengthDelimited).string(message.sources[i]);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message CompileResponse
 */
export const CompileResponse = new CompileResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class Log$Type extends MessageType<Log> {
  constructor() {
    super("Log", [
      { no: 1, name: "level", kind: "enum", T: () => ["LogLevel", LogLevel] },
      { no: 2, name: "message", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value?: PartialMessage<Log>): Log {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.level = 0;
    message.message = "";
    if (value !== undefined) reflectionMergePartial<Log>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: Log): Log {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* LogLevel level */ 1:
          message.level = reader.int32();
          break;
        case /* string message */ 2:
          message.message = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: Log, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* LogLevel level = 1; */
    if (message.level !== 0) writer.tag(1, WireType.Varint).int32(message.level);
    /* string message = 2; */
    if (message.message !== "") writer.tag(2, WireType.LengthDelimited).string(message.message);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message Log
 */
export const Log = new Log$Type();
// @generated message type with reflection information, may provide speed optimized methods
class GetConfigurationRequest$Type extends MessageType<GetConfigurationRequest> {
  constructor() {
    super("GetConfigurationRequest", []);
  }
  create(value?: PartialMessage<GetConfigurationRequest>): GetConfigurationRequest {
    const message = globalThis.Object.create(this.messagePrototype!);
    if (value !== undefined) reflectionMergePartial<GetConfigurationRequest>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: GetConfigurationRequest): GetConfigurationRequest {
    return target ?? this.create();
  }
  internalBinaryWrite(message: GetConfigurationRequest, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message GetConfigurationRequest
 */
export const GetConfigurationRequest = new GetConfigurationRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class GetConfigurationResponse$Type extends MessageType<GetConfigurationResponse> {
  constructor() {
    super("GetConfigurationResponse", [
      { no: 1, name: "configuration", kind: "message", T: () => Configuration },
      { no: 2, name: "logs", kind: "message", repeat: 1 /*RepeatType.PACKED*/, T: () => Log },
    ]);
  }
  create(value?: PartialMessage<GetConfigurationResponse>): GetConfigurationResponse {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.logs = [];
    if (value !== undefined) reflectionMergePartial<GetConfigurationResponse>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: GetConfigurationResponse): GetConfigurationResponse {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* Configuration configuration */ 1:
          message.configuration = Configuration.internalBinaryRead(reader, reader.uint32(), options, message.configuration);
          break;
        case /* repeated Log logs */ 2:
          message.logs.push(Log.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: GetConfigurationResponse, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* Configuration configuration = 1; */
    if (message.configuration) Configuration.internalBinaryWrite(message.configuration, writer.tag(1, WireType.LengthDelimited).fork(), options).join();
    /* repeated Log logs = 2; */
    for (let i = 0; i < message.logs.length; i++) Log.internalBinaryWrite(message.logs[i], writer.tag(2, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message GetConfigurationResponse
 */
export const GetConfigurationResponse = new GetConfigurationResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class Configuration$Type extends MessageType<Configuration> {
  constructor() {
    super("Configuration", [
      { no: 1, name: "path_prefix", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 2, name: "projects", kind: "message", repeat: 1 /*RepeatType.PACKED*/, T: () => ConfigurationProject },
      { no: 3, name: "ai", kind: "message", T: () => ConfigurationAI },
    ]);
  }
  create(value?: PartialMessage<Configuration>): Configuration {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.pathPrefix = "";
    message.projects = [];
    if (value !== undefined) reflectionMergePartial<Configuration>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: Configuration): Configuration {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string path_prefix */ 1:
          message.pathPrefix = reader.string();
          break;
        case /* repeated ConfigurationProject projects */ 2:
          message.projects.push(ConfigurationProject.internalBinaryRead(reader, reader.uint32(), options));
          break;
        case /* ConfigurationAI ai */ 3:
          message.ai = ConfigurationAI.internalBinaryRead(reader, reader.uint32(), options, message.ai);
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: Configuration, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* string path_prefix = 1; */
    if (message.pathPrefix !== "") writer.tag(1, WireType.LengthDelimited).string(message.pathPrefix);
    /* repeated ConfigurationProject projects = 2; */
    for (let i = 0; i < message.projects.length; i++)
      ConfigurationProject.internalBinaryWrite(message.projects[i], writer.tag(2, WireType.LengthDelimited).fork(), options).join();
    /* ConfigurationAI ai = 3; */
    if (message.ai) ConfigurationAI.internalBinaryWrite(message.ai, writer.tag(3, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message Configuration
 */
export const Configuration = new Configuration$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ConfigurationProject$Type extends MessageType<ConfigurationProject> {
  constructor() {
    super("ConfigurationProject", [
      { no: 1, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 2, name: "protocol", kind: "enum", T: () => ["RpcProtocol", RpcProtocol, "RPC_PROTOCOL_"] },
      { no: 3, name: "url", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 4, name: "workspace", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value?: PartialMessage<ConfigurationProject>): ConfigurationProject {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.name = "";
    message.protocol = 0;
    message.url = "";
    message.workspace = "";
    if (value !== undefined) reflectionMergePartial<ConfigurationProject>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: ConfigurationProject): ConfigurationProject {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string name */ 1:
          message.name = reader.string();
          break;
        case /* RpcProtocol protocol */ 2:
          message.protocol = reader.int32();
          break;
        case /* string url */ 3:
          message.url = reader.string();
          break;
        case /* string workspace */ 4:
          message.workspace = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: ConfigurationProject, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* string name = 1; */
    if (message.name !== "") writer.tag(1, WireType.LengthDelimited).string(message.name);
    /* RpcProtocol protocol = 2; */
    if (message.protocol !== 0) writer.tag(2, WireType.Varint).int32(message.protocol);
    /* string url = 3; */
    if (message.url !== "") writer.tag(3, WireType.LengthDelimited).string(message.url);
    /* string workspace = 4; */
    if (message.workspace !== "") writer.tag(4, WireType.LengthDelimited).string(message.workspace);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message ConfigurationProject
 */
export const ConfigurationProject = new ConfigurationProject$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ConfigurationAI$Type extends MessageType<ConfigurationAI> {
  constructor() {
    super("ConfigurationAI", [
      { no: 1, name: "base_url", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 2, name: "api_key", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value?: PartialMessage<ConfigurationAI>): ConfigurationAI {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.baseUrl = "";
    message.apiKey = "";
    if (value !== undefined) reflectionMergePartial<ConfigurationAI>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: ConfigurationAI): ConfigurationAI {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string base_url */ 1:
          message.baseUrl = reader.string();
          break;
        case /* string api_key */ 2:
          message.apiKey = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message: ConfigurationAI, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
    /* string base_url = 1; */
    if (message.baseUrl !== "") writer.tag(1, WireType.LengthDelimited).string(message.baseUrl);
    /* string api_key = 2; */
    if (message.apiKey !== "") writer.tag(2, WireType.LengthDelimited).string(message.apiKey);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message ConfigurationAI
 */
export const ConfigurationAI = new ConfigurationAI$Type();
/**
 * @generated ServiceType for protobuf service Api
 */
export const Api = new ServiceType("Api", [
  { name: "Compile", options: {}, I: CompileRequest, O: CompileResponse },
  { name: "GetConfiguration", options: {}, I: GetConfigurationRequest, O: GetConfigurationResponse },
]);
