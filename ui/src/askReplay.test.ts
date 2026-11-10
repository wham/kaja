import { describe, expect, it } from "bun:test";
import { AskBlock, Block } from "./blocks";
import { AskReplay, Kaja, MethodCall } from "./kaja";

function asking(answer: (question: AskBlock) => string, options: { reopenable?: boolean; replay?: AskReplay } = {}) {
  const blocks = new Map<string, Block>();
  const asked: AskBlock[] = [];
  const kaja = new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: async (question) => {
      asked.push(question);
      return answer(question);
    },
    onApprove: () => Promise.reject(new Error("not approved")),
    onBlockUpdate: (blockId, block) => void blocks.set(blockId, block),
    onLog: () => {},
    reopenable: options.reopenable ?? true,
    replay: options.replay,
  });
  const asks = () => [...blocks.entries()].filter((entry): entry is [string, AskBlock] => entry[1].kind === "ask");
  return { kaja, asked, asks };
}

const picks: { [question: string]: string } = { "Category?": "Everyone", "Who gets it?": "Team" };

describe("going back to a question", () => {
  it("replays the answers before it and asks it again with what it had", async () => {
    const first = asking((question) => picks[question.question]);
    await first.kaja.askSelect("Category?", ["Team", "Everyone"]);
    await first.kaja.askSelect("Who gets it?", ["Team", "Others"]);
    const [[categoryId], [whoId]] = first.asks();

    const replay = first.kaja.reopen(whoId)!;
    expect(replay.answers.map((block) => block.answer)).toEqual(["Everyone"]);
    expect(first.kaja.reopen(categoryId)!.answers).toEqual([]);

    const second = asking(() => "Others", { replay });
    expect(await second.kaja.askSelect("Category?", ["Team", "Everyone"])).toBe("Everyone");
    expect(await second.kaja.askSelect("Who gets it?", ["Team", "Others"])).toBe("Others");
    expect(second.asked.map((question) => [question.question, question.previous])).toEqual([["Who gets it?", "Team"]]);
  });

  it("asks everything from the first question the script asks differently", async () => {
    const replay: AskReplay = {
      answers: [{ kind: "ask", question: "Category?", answerType: "select", choices: ["Team", "Everyone"], answer: "Everyone" }],
      reopened: { kind: "ask", question: "Who gets it?", answerType: "str", answer: "Team" },
    };
    const run = asking(() => "Team", { replay });
    await run.kaja.askSelect("Category?", ["Team", "Nobody"]);
    await run.kaja.askStr("Who gets it?");
    expect(run.asked.map((question) => [question.question, question.previous])).toEqual([
      ["Category?", undefined],
      ["Who gets it?", undefined],
    ]);
  });

  it("can't go back past a call, which would be sent again", async () => {
    const run = asking(() => "x");
    await run.kaja.askStr("Before?");
    run.kaja._internal.methodCallUpdate({ id: "1", service: { name: "S" }, method: { name: "M" } } as unknown as MethodCall);
    await run.kaja.askStr("After?");
    const [[beforeId, before], [afterId, after]] = run.asks();
    expect(before.reopenable).toBe(true);
    expect(after.reopenable).toBeUndefined();
    expect(run.kaja.reopen(beforeId)).toBeDefined();
    expect(run.kaja.reopen(afterId)).toBeUndefined();
  });

  it("offers nothing where the run can't be started again", async () => {
    const run = asking(() => "x", { reopenable: false });
    await run.kaja.askStr("Name?");
    const [[blockId, block]] = run.asks();
    expect(block.reopenable).toBeUndefined();
    expect(run.kaja.reopen(blockId)).toBeUndefined();
  });
});
