// Example Kaja script. Lives in <project>/scripts/ and shows up under the
// project in the sidebar. Edit freely and ⌘S to save.
import { GRPCBinClient } from "grpcb.in/proto/grpcbin/grpcbin.client";
import { DummyMessage } from "grpcb.in/proto/grpcbin/grpcbin";

const client: GRPCBinClient = $client;

const request: DummyMessage = {
  fString: "hello from kaja",
  fStrings: [],
  fInt32: 0,
  fInt32s: [],
  fEnum: 0,
  fEnums: [],
  fSub: undefined,
  fSubs: [],
  fBool: false,
  fBools: [],
  fInt64: "0",
  fInt64s: [],
  fBytes: new Uint8Array(),
  fBytess: [],
  fFloat: 0,
  fFloats: [],
};

const { response } = await client.dummyUnary(request);
console.log(response.fString);
