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
  /**
   * @generated from protobuf field: RpcProtocol rpc_protocol = 4;
   */
  rpcProtocol: RpcProtocol;
}
/**
 * @generated from protobuf message Log
 */
export interface Log {
  /**
   * @generated from protobuf field: string message = 1;
   */
  message: string;
  /**
   * @generated from protobuf field: int32 index = 2;
   */
  index: number;
  /**
   * @generated from protobuf field: LogLevel level = 3;
   */
  level: LogLevel;
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
    ]);
  }
  create(value?: PartialMessage<CompileRequest>): CompileRequest {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.logOffset = 0;
    message.force = false;
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
      { no: 4, name: "rpc_protocol", kind: "enum", T: () => ["RpcProtocol", RpcProtocol, "RPC_PROTOCOL_"] },
    ]);
  }
  create(value?: PartialMessage<CompileResponse>): CompileResponse {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.status = 0;
    message.logs = [];
    message.sources = [];
    message.rpcProtocol = 0;
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
        case /* RpcProtocol rpc_protocol */ 4:
          message.rpcProtocol = reader.int32();
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
    /* RpcProtocol rpc_protocol = 4; */
    if (message.rpcProtocol !== 0) writer.tag(4, WireType.Varint).int32(message.rpcProtocol);
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
      { no: 1, name: "message", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 2, name: "index", kind: "scalar", T: 5 /*ScalarType.INT32*/ },
      { no: 3, name: "level", kind: "enum", T: () => ["LogLevel", LogLevel] },
    ]);
  }
  create(value?: PartialMessage<Log>): Log {
    const message = globalThis.Object.create(this.messagePrototype!);
    message.message = "";
    message.index = 0;
    message.level = 0;
    if (value !== undefined) reflectionMergePartial<Log>(this, message, value);
    return message;
  }
  internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: Log): Log {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string message */ 1:
          message.message = reader.string();
          break;
        case /* int32 index */ 2:
          message.index = reader.int32();
          break;
        case /* LogLevel level */ 3:
          message.level = reader.int32();
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
    /* string message = 1; */
    if (message.message !== "") writer.tag(1, WireType.LengthDelimited).string(message.message);
    /* int32 index = 2; */
    if (message.index !== 0) writer.tag(2, WireType.Varint).int32(message.index);
    /* LogLevel level = 3; */
    if (message.level !== 0) writer.tag(3, WireType.Varint).int32(message.level);
    let u = options.writeUnknownFields;
    if (u !== false) (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message Log
 */
export const Log = new Log$Type();
/**
 * @generated ServiceType for protobuf service Api
 */
export const Api = new ServiceType("Api", [{ name: "Compile", options: {}, I: CompileRequest, O: CompileResponse }]);
