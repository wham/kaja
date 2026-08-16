import { describe, expect, it } from "bun:test";
import { Block } from "./blocks";
import { Call, Kaja, KajaHost } from "./kaja";
import { LogLevel } from "./server/api";

/**
 * Two runs at once is the ordinary case, not the exotic one: ⌘⏎ twice, Run on a
 * second file, a `kaja://` link arriving mid-script, an agent calling
 * run_script. Each of these tests is a way one run used to be able to reach
 * another when there was one `Kaja` for the window and the run was read off an
 * ambient ref.
 */

// A run, and everything it produced, kept apart from every other run's.
function run(host: KajaHost, name: string) {
  const blocks = new Map<string, Block>();
  const logs: string[] = [];
  const calls: string[] = [];
  const asked: string[] = [];
  const kaja = host.run({
    onMethodCallUpdate: (methodCall) => void calls.push(`${name}:${methodCall.method.name}`),
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: (call) => {
      asked.push(`${name}:${call.method}`);
      return Promise.resolve("all" as const);
    },
    onBlockUpdate: (blockId, block) => void blocks.set(blockId, block),
    onLog: (_level: LogLevel, message: string) => void logs.push(`${name}:${message}`),
  });
  return { kaja, blocks, logs, calls, asked };
}

function stub(method: string): { call: Call<string>; sends: number } {
  const state = { sends: 0 };
  const call = new Call(method, {}, async () => {
    state.sends++;
    return "sent";
  });
  return {
    call,
    get sends() {
      return state.sends;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("two runs at once", () => {
  it("does not let one run's standing approval send another's call", async () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");

    // A grants "every CreateShow this run".
    const first = stub("Shows.CreateShow");
    await a.kaja.approve(first.call);
    expect(a.asked).toEqual(["a:Shows.CreateShow"]);

    // B's call to the same method is B's to decide, and must be asked about.
    const second = stub("Shows.CreateShow");
    await b.kaja.approve(second.call);
    expect(b.asked).toEqual(["b:Shows.CreateShow"]);

    // And A's own second call still rides its standing approval.
    const third = stub("Shows.CreateShow");
    await a.kaja.approve(third.call);
    expect(a.asked).toEqual(["a:Shows.CreateShow"]);
  });

  it("does not let a run starting revoke an approval another run was given", async () => {
    const host = new KajaHost();
    const a = run(host, "a");

    await a.kaja.approve(stub("Shows.CreateShow").call);
    // Starting a second run is what used to clear the shared set out from under
    // the first one, so its loop began asking again halfway through.
    run(host, "b");

    await a.kaja.approve(stub("Shows.CreateShow").call);
    expect(a.asked).toEqual(["a:Shows.CreateShow"]);
  });

  it("keeps each run's blocks and printed lines to itself", () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");

    a.kaja.text("from a");
    b.kaja.text("from b");
    a.kaja._internal.onLog(LogLevel.LEVEL_INFO, "a said so");
    b.kaja._internal.onLog(LogLevel.LEVEL_INFO, "b said so");

    expect(a.blocks.size).toBe(1);
    expect(b.blocks.size).toBe(1);
    expect(a.logs).toEqual(["a:a said so"]);
    expect(b.logs).toEqual(["b:b said so"]);
  });

  it("gives each run its own input, and never the other's", () => {
    const host = new KajaHost();
    const linked = host.run({ ...sink(), input: { url: "https://example.test" } });
    const pressed = host.run(sink());

    expect(linked.input).toEqual({ url: "https://example.test" });
    // Pressing Run carries no input. It used to be able to find the last link's.
    expect(pressed.input).toEqual({});
  });

  it("aborts only the run that was stopped", () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");
    const stopping = new AbortController();
    a.kaja._internal.abortSignal = stopping.signal;

    stopping.abort();

    expect(a.kaja._internal.abortSignal?.aborted).toBe(true);
    expect(b.kaja._internal.abortSignal).toBeUndefined();
  });

  it("shares the workspace's variables, which belong to no run", () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");

    a.kaja.variables = { TOKEN: "secret" };

    expect(b.kaja.variables.TOKEN).toBe("secret");
    expect(host.variables.TOKEN).toBe("secret");
  });
});

describe("a table outlives the run that drew it", () => {
  it("pages through the run that drew it, however many others are going", async () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");

    // A draws a live table whose source fetches a row at a time. Every fetch is
    // a call, and it must be recorded against A whenever the reader pages —
    // which is long after A has finished.
    a.kaja.table(
      ["id"],
      async function* () {
        for (let i = 0; i < 100; i++) {
          await a.kaja._internal.methodCallUpdate({
            id: `call-${i}`,
            appName: "shows",
            service: { name: "Shows" },
            method: { name: "ListShows" },
            input: {},
            timestamp: 0,
          } as never);
          yield [String(i)];
        }
      },
      { pageSize: 2 },
    );
    await a.kaja.settleTables();

    const blockId = [...a.blocks.keys()][0];
    const afterFirstPage = a.calls.length;
    expect(afterFirstPage).toBeGreaterThan(0);

    // B is running now. Paging A's table is still A's work.
    b.kaja.text("b is busy");
    expect(await host.pullTable(blockId, "", afterFirstPage + 2)).toBe(true);

    expect(a.calls.length).toBeGreaterThan(afterFirstPage);
    expect(a.calls.every((call) => call.startsWith("a:"))).toBe(true);
    expect(b.calls).toEqual([]);
  });

  it("waits only for its own tables when it settles", async () => {
    const host = new KajaHost();
    const a = run(host, "a");
    const b = run(host, "b");

    let released = false;
    // B's source never finishes until the test lets it.
    b.kaja.table(["id"], async function* () {
      await new Promise<void>((resolve) => {
        const wait = () => (released ? resolve() : setTimeout(wait, 1));
        wait();
      });
      yield ["b"];
    });

    a.kaja.table(["id"], [["a"]]);
    // A's settle must not be held open by a table B is still filling.
    await a.kaja.settleTables();

    released = true;
    await b.kaja.settleTables();
    expect(true).toBe(true);
  });

  it("keeps one budget for live tables across every run", async () => {
    const host = new KajaHost();
    const blockIds: string[] = [];

    // Thirty live tables spread over three runs is still thirty against one
    // budget — a map per run would have let each run hold its own MAX, so the
    // closures the app is keeping would scale with how many scripts you ran.
    for (let i = 0; i < 3; i++) {
      const each = run(host, `r${i}`);
      for (let j = 0; j < 10; j++) {
        each.kaja.table(["id"], async function* () {
          yield ["row"];
        });
      }
      await each.kaja.settleTables();
      for (const blockId of each.blocks.keys()) if (!blockIds.includes(blockId)) blockIds.push(blockId);
    }

    expect(blockIds.length).toBe(30);
    expect(blockIds.filter((blockId) => host.hasLiveTable(blockId)).length).toBeLessThanOrEqual(24);
    // And the ones let go are the oldest, so the table you just drew is the one
    // that can still be paged.
    expect(host.hasLiveTable(blockIds[blockIds.length - 1])).toBe(true);
    expect(host.hasLiveTable(blockIds[0])).toBe(false);
  });
});

function sink() {
  return {
    onMethodCallUpdate: () => {},
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: () => Promise.reject(new Error("not approved")),
    onBlockUpdate: () => {},
    onLog: () => {},
  };
}

// A call that is never claimed sends itself at the end of the tick, which is what
// makes the approval tests above about approval rather than about timing.
describe("the tick", () => {
  it("still sends an unclaimed call", async () => {
    const stubbed = stub("Shows.Ping");
    await tick();
    expect(stubbed.sends).toBe(1);
  });
});
