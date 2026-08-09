import { describe, expect, it } from "bun:test";
import { ApproveBlock, Block } from "./blocks";
import { ApprovalRejectedError, Call, Kaja } from "./kaja";

// A Kaja whose canvas is a map, and whose approvals are decided by the test.
function held(decide: (method: string, request: string) => Promise<void>) {
  const blocks = new Map<string, Block>();
  const kaja = new Kaja(
    () => {},
    () => Promise.reject(new Error("not asked")),
    (method, request) => decide(method, request),
    (blockId, block) => void blocks.set(blockId, block),
  );
  const only = (): ApproveBlock => {
    const block = [...blocks.values()].find((block) => block.kind === "approve");
    if (block?.kind !== "approve") throw new Error("nothing was held for approval");
    return block;
  };
  return { kaja, only };
}

function stub(): { call: Call<string>; sends: number } {
  const state = { sends: 0 };
  const call = new Call("Shows.CreateShow", { title: "Vera Lune" }, async () => {
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
    const { kaja, only } = held(async () => {});
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
    const { kaja } = held(() => new Promise<void>((resolve) => (decide = resolve)));
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
    const { kaja, only } = held(async (method, request) => {
      drawn = only();
      expect(method).toBe("Shows.CreateShow");
      expect(request).toContain("Vera Lune");
    });

    await kaja.approve(stub().call);

    expect(drawn).toEqual({ kind: "approve", method: "Shows.CreateShow", request: '{\n  "title": "Vera Lune"\n}' });
  });

  it("refuses a call that has already gone out, which nothing could take back", async () => {
    const { kaja } = held(async () => {});
    const stubbed = stub();
    await tick();

    await expect(kaja.approve(stubbed.call)).rejects.toThrow(/already been sent/);
    expect(stubbed.sends).toBe(1);
  });
});
