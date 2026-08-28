import { describe, expect, it } from "bun:test";
import { Call, callResponseHeaders, MethodCall, MethodCallHeaders } from "./kaja";

// A call that records when it was sent, so the tests can ask the only question
// that matters about a Call: has the request gone out yet?
function stub<T>(value: T): { call: Call<T>; sends: number } {
  const state = { sends: 0 };
  const call = new Call("Shows.ListShows", { pageSize: 25 }, async () => {
    state.sends++;
    return value;
  });
  return {
    call,
    get sends() {
      return state.sends;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Call", () => {
  it("doesn't send while the tick it was written in is still running", () => {
    const stubbed = stub("shows");
    expect(stubbed.sends).toBe(0);
    expect(stubbed.call.started).toBe(false);
  });

  it("sends when it is awaited", async () => {
    const stubbed = stub("shows");
    expect(await stubbed.call).toBe("shows");
    expect(stubbed.sends).toBe(1);
  });

  it("sends at the end of the tick when nothing claims it", async () => {
    const stubbed = stub("shows");
    await tick();
    expect(stubbed.sends).toBe(1);
    expect(stubbed.call.started).toBe(true);
  });

  it("sends once however many times it is read", async () => {
    const stubbed = stub("shows");
    const [first, second] = await Promise.all([stubbed.call, stubbed.call]);
    await tick();
    expect([first, second]).toEqual(["shows", "shows"]);
    expect(stubbed.sends).toBe(1);
  });

  it("runs concurrently under Promise.all, which is what a fan-out is", async () => {
    const first = stub("a");
    const second = stub("b");
    expect(await Promise.all([first.call, second.call])).toEqual(["a", "b"]);
    expect(first.sends + second.sends).toBe(2);
  });

  it("stays unsent once claimed, and goes out when it is started", async () => {
    const stubbed = stub("shows");
    stubbed.call.claim();
    await tick();
    expect(stubbed.sends).toBe(0);

    expect(await stubbed.call.start()).toBe("shows");
    expect(stubbed.sends).toBe(1);
  });

  it("carries what it is, so a canvas can name it before it happens", () => {
    const { call } = stub("shows");
    expect(call.label).toBe("Shows.ListShows");
    expect(call.input).toEqual({ pageSize: 25 });
  });
});

// The headers are read when the call settles rather than handed over when it is
// made, because that is the only moment they exist.
function answered(headers: MethodCallHeaders, fail = false): Call<string> {
  let settled = false;
  return new Call(
    "Shows.ListShows",
    {},
    async () => {
      settled = true;
      if (fail) throw new Error("refused");
      return "shows";
    },
    () => (settled ? headers : {}),
  );
}

describe("Call.headers", () => {
  it("resolves with what the call was answered with", async () => {
    const call = answered({ etag: 'W/"1"' });
    expect(await call).toBe("shows");
    expect(await call.headers).toEqual({ etag: 'W/"1"' });
  });

  it("can be read before the response, and sends the call once", async () => {
    let sends = 0;
    const call = new Call(
      "Shows.ListShows",
      {},
      async () => {
        sends++;
        return "shows";
      },
      () => ({ "x-request-id": "abc" }),
    );
    const [headers, response] = await Promise.all([call.headers, call]);
    expect(headers).toEqual({ "x-request-id": "abc" });
    expect(response).toBe("shows");
    expect(sends).toBe(1);
  });

  it("resolves on a call that failed, which is when they are worth reading", async () => {
    const call = answered({ "www-authenticate": "Bearer" }, true);
    await expect(call.start()).rejects.toThrow("refused");
    expect(await call.headers).toEqual({ "www-authenticate": "Bearer" });
  });

  it("is empty for a call nothing reported headers for", async () => {
    const call = new Call("Shows.ListShows", {}, async () => "shows");
    expect(await call.headers).toEqual({});
  });
});

describe("callResponseHeaders", () => {
  const call = (fields: Partial<MethodCall>) => callResponseHeaders(fields as MethodCall);

  it("reads the API's own answer where kaja carried the call for it", () => {
    expect(
      call({
        upstreamResponseHeaders: { "X-RateLimit-Remaining": "42" },
        responseHeaders: { "content-type": "application/grpc-web+proto" },
      }),
    ).toEqual({ "x-ratelimit-remaining": "42" });
  });

  it("falls back on the transport's own, which is the API's when nothing stood between", () => {
    expect(call({ responseHeaders: { "Content-Type": "application/json" } })).toEqual({
      "content-type": "application/json",
    });
  });

  it("is empty for a call that never reported any", () => {
    expect(call({})).toEqual({});
    expect(callResponseHeaders(undefined)).toEqual({});
  });
});
