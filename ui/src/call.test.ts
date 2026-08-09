import { describe, expect, it } from "bun:test";
import { Call } from "./kaja";

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
