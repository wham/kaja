import { describe, expect, it } from "bun:test";
import { ApproveBlock, Block } from "./blocks";
import { ApprovalRejectedError, ApproveDecision, Call, Kaja } from "./kaja";

// A Kaja whose canvas is a map, and whose approvals are decided by the test. The
// asks are counted, because "how many times was I asked" is the whole of what a
// standing approval changes.
function held(decide: (call: ApproveBlock) => Promise<ApproveDecision>) {
  const blocks = new Map<string, Block>();
  const asked: string[] = [];
  const kaja = new Kaja(
    () => {},
    () => Promise.reject(new Error("not asked")),
    (call) => {
      asked.push(call.method);
      return decide(call);
    },
    (blockId, block) => void blocks.set(blockId, block),
    () => {},
  );
  const approvals = (): ApproveBlock[] => [...blocks.values()].filter((block): block is ApproveBlock => block.kind === "approve");
  const only = (): ApproveBlock => {
    const block = approvals()[0];
    if (!block) throw new Error("nothing was held for approval");
    return block;
  };
  return { kaja, only, approvals, asked };
}

function stub(method = "Shows.CreateShow"): { call: Call<string>; sends: number } {
  const state = { sends: 0 };
  const call = new Call(method, { title: "Vera Lune" }, async () => {
    state.sends++;
    return "show-1";
  });
  return {
    call,
    get sends() {
      return state.sends;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("kaja.approve", () => {
  it("holds the call until it is approved, then sends it and hands back the response", async () => {
    const { kaja, only } = held(async () => "approved");
    const stubbed = stub();

    const response = await kaja.approve(stubbed.call);

    expect(response).toBe("show-1");
    expect(stubbed.sends).toBe(1);
    expect(only()).toEqual({ kind: "approve", method: "Shows.CreateShow", request: '{\n  "title": "Vera Lune"\n}', decision: "approved" });
  });

  it("never sends the call when it is not approved", async () => {
    const { kaja, only } = held(async () => {
      throw new ApprovalRejectedError();
    });
    const stubbed = stub();

    await expect(kaja.approve(stubbed.call)).rejects.toBeInstanceOf(ApprovalRejectedError);
    // The tick that would have started an unclaimed call has been and gone.
    await tick();
    expect(stubbed.sends).toBe(0);
    expect(only().decision).toBe("rejected");
  });

  it("holds the call for as long as the question is on screen", async () => {
    let decide = () => {};
    const { kaja } = held(() => new Promise<ApproveDecision>((resolve) => (decide = () => resolve("approved"))));
    const stubbed = stub();

    const approving = kaja.approve(stubbed.call);
    // Several ticks with the question unanswered. A call that was only first in
    // line rather than claimed would have gone out in the first of them.
    await tick();
    await tick();
    expect(stubbed.sends).toBe(0);

    decide();
    await approving;
    expect(stubbed.sends).toBe(1);
  });

  it("draws the call before it asks, so the canvas parks on it", async () => {
    let drawn: ApproveBlock | undefined;
    const { kaja, only } = held(async (call) => {
      drawn = only();
      expect(call.method).toBe("Shows.CreateShow");
      expect(call.request).toContain("Vera Lune");
      return "approved";
    });

    await kaja.approve(stub().call);

    expect(drawn).toEqual({ kind: "approve", method: "Shows.CreateShow", request: '{\n  "title": "Vera Lune"\n}' });
  });

  it("refuses a call that has already gone out, which nothing could take back", async () => {
    const { kaja } = held(async () => "approved");
    const stubbed = stub();
    await tick();

    await expect(kaja.approve(stubbed.call)).rejects.toThrow(/already been sent/);
    expect(stubbed.sends).toBe(1);
  });
});

describe("kaja.approve — approve all", () => {
  it("asks once, then sends every later call to the same method", async () => {
    const { kaja, asked } = held(async () => "all");

    const first = stub();
    expect(await kaja.approve(first.call)).toBe("show-1");
    const second = stub();
    expect(await kaja.approve(second.call)).toBe("show-1");

    expect(first.sends).toBe(1);
    expect(second.sends).toBe(1);
    expect(asked).toEqual(["Shows.CreateShow"]);
  });

  it("draws nothing for the calls that ride on it — they are cards and rows already", async () => {
    const { kaja, approvals } = held(async () => "all");

    await kaja.approve(stub().call);
    await kaja.approve(stub().call);

    expect(approvals()).toEqual([
      { kind: "approve", method: "Shows.CreateShow", request: '{\n  "title": "Vera Lune"\n}', decision: "approved", standing: true },
    ]);
  });

  it("does not reach another method", async () => {
    const { kaja, asked } = held(async () => "all");

    await kaja.approve(stub("Shows.CreateShow").call);
    await kaja.approve(stub("Shows.DeleteShow").call);
    await kaja.approve(stub("Shows.CreateShow").call);

    expect(asked).toEqual(["Shows.CreateShow", "Shows.DeleteShow"]);
  });

  it("covers the run it was given in and no further", async () => {
    const { kaja, asked } = held(async () => "all");

    await kaja.approve(stub().call);
    // What runScript does at the top of every run: the guard is back the next time
    // Run is pressed.
    kaja._internal.approvedMethods.clear();
    await kaja.approve(stub().call);

    expect(asked).toEqual(["Shows.CreateShow", "Shows.CreateShow"]);
  });

  it("sends a standing call at once and only once", async () => {
    const { kaja } = held(async () => "all");
    await kaja.approve(stub().call);

    const stubbed = stub();
    const approving = kaja.approve(stubbed.call);
    // Nothing is waited on, so the call goes out in the turn it was written in —
    // which is what "let it run" asked for. It is still claimed, so the tick that
    // starts an unclaimed call has nothing left to start.
    expect(stubbed.sends).toBe(1);

    await approving;
    await tick();
    expect(stubbed.sends).toBe(1);
  });
});
