import { expect, test } from "bun:test";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import { rpcErrorMessage } from "./rpcMessage";

test("decodes what a gRPC status message travelled as", () => {
  expect(rpcErrorMessage(new RpcError("no show %E2%80%94 list them all", "NOT_FOUND"))).toBe("no show — list them all");
});

// A message that isn't valid percent-encoding is still the message.
test("leaves a message decodeURIComponent refuses", () => {
  expect(rpcErrorMessage(new RpcError("100% of the time", "UNKNOWN"))).toBe("100% of the time");
});

// Only a status message travels encoded, so nothing else is decoded.
test("leaves everything that is not a status message alone", () => {
  expect(rpcErrorMessage(new Error("50%"))).toBe("50%");
  expect(rpcErrorMessage("premature EOF")).toBe("premature EOF");
  expect(rpcErrorMessage(undefined)).toBe("undefined");
});
