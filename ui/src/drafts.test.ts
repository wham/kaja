import { describe, expect, it } from "bun:test";
import {
  appendCall,
  createDraft,
  agentLabel,
  agentOverflow,
  findAgentDraft,
  findSpare,
  findUntouched,
  isUntouched,
  markRun,
  recentDrafts,
  reopen,
  shortAge,
  Draft,
  takeOver,
  withCode,
} from "./drafts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const listForUser = `import { Repos } from "github/service";\n\nRepos.ListForUser({});\n`;
const getRepo = `import { Repos } from "github/service";\n\nRepos.Get({ id: "" });\n`;
const sayHello = `import { HelloService } from "grpcb.in";\n\nHelloService.SayHello({});\n`;

describe("createDraft", () => {
  it("names itself from the code it was born with", () => {
    expect(createDraft(listForUser, undefined, NOW).title).toBe("ListForUser");
  });

  it("falls back when the code calls nothing", () => {
    expect(createDraft("// empty", undefined, NOW).title).toBe("Draft");
  });
});

describe("isUntouched", () => {
  it("is true only while the code is still what was generated and nothing has run", () => {
    const draft = createDraft(listForUser, undefined, NOW);
    expect(isUntouched(draft)).toBe(true);
    expect(isUntouched({ ...draft, code: listForUser + "// mine" })).toBe(false);
    expect(isUntouched({ ...draft, ran: true })).toBe(false);
  });
});

describe("findUntouched", () => {
  const buffer = (code: string, originAppName?: string, extra: Partial<Draft> = {}) => ({
    ...createDraft(code, originAppName, NOW),
    ...extra,
  });

  it("finds the browsing buffer that already holds the call", () => {
    const held = buffer(listForUser, "github");
    expect(findUntouched([buffer(getRepo, "github"), held], listForUser, "github")?.id).toBe(held.id);
  });

  it("takes the most recent of several", () => {
    const [newest, oldest] = [buffer(listForUser, "github"), buffer(listForUser, "github")];
    expect(findUntouched([newest, oldest], listForUser, "github")?.id).toBe(newest.id);
  });

  it("never reaches a draft that was worked in", () => {
    expect(findUntouched([buffer(listForUser, "github", { ran: true })], listForUser, "github")).toBeUndefined();
    expect(findUntouched([buffer(listForUser, "github", { code: listForUser + "// mine" })], listForUser, "github")).toBeUndefined();
  });

  it("keeps two apps apart even when their code reads the same", () => {
    expect(findUntouched([buffer(sayHello, "grpcb.in")], sayHello, "github")).toBeUndefined();
  });
});

describe("reopen", () => {
  it("says the buffer is the one being browsed and settles nothing else", () => {
    const draft = createDraft(listForUser, undefined, NOW);
    const held = reopen(draft, NOW + 1);

    expect(held.updatedAt).toBe(NOW + 1);
    expect(isUntouched(held)).toBe(true);
    expect(held.title).toBe(draft.title);
  });
});

describe("takeOver", () => {
  it("re-points a browsing buffer at another method and renames it", () => {
    const taken = takeOver(createDraft(listForUser, undefined, NOW), getRepo, undefined, NOW + 1);
    expect(taken.title).toBe("Get");
    expect(isUntouched(taken)).toBe(true);
  });
});

describe("markRun", () => {
  it("re-reads the title from the code as it stands at the run", () => {
    const draft = createDraft(getRepo, undefined, NOW);
    const filled = getRepo.replace('id: ""', 'id: "kaja"');
    const ran = markRun(draft, filled, NOW + 1);

    expect(ran.title).toBe("Get · kaja");
    expect(ran.ran).toBe(true);
  });
});

describe("withCode", () => {
  it("settles the title on an append, the way a run does", () => {
    const appended = withCode(createDraft(listForUser, undefined, NOW), appendCall(listForUser, getRepo), NOW + 1);
    expect(appended.title).toBe("ListForUser → Get");
  });
});

describe("Recent", () => {
  const draft = (id: string, updatedAt: number, extra: Partial<Draft> = {}): Draft => ({
    ...createDraft(listForUser, undefined, updatedAt),
    id,
    updatedAt,
    ...extra,
  });

  it("lists what was run or written in, newest first, whoever made it", () => {
    const recent = recentDrafts(
      [
        draft("picked", NOW),
        draft("edited", NOW - 3 * DAY, { code: listForUser + "// mine" }),
        draft("agent", NOW - 2 * DAY, { agentName: "Claude", ran: true }),
        draft("ran", NOW - DAY, { ran: true }),
      ],
      undefined,
    );

    expect(recent.map((draft) => draft.id)).toEqual(["ran", "agent", "edited"]);
  });

  it("lists a call that was only picked while it is the one on screen", () => {
    expect(recentDrafts([draft("picked", NOW)], "picked").map((draft) => draft.id)).toEqual(["picked"]);
  });

  it("hands the next picked call a buffer nobody is looking at", () => {
    const agent = draft("agent", NOW, { agentName: "Claude" });
    expect(findSpare([agent, draft("ran", NOW, { ran: true }), draft("picked", NOW)])?.id).toBe("picked");
  });

  it("runs an agent's snippet where that agent ran the same call", () => {
    const drafts = [draft("codex", NOW, { agentName: "Codex", ran: true }), draft("claude", NOW, { agentName: "Claude", ran: true })];
    expect(findAgentDraft(drafts, "Claude", listForUser.replace("{}", '{ username: "a" }'))?.id).toBe("claude");
    expect(findAgentDraft(drafts, "Claude", getRepo)).toBeUndefined();
    expect(findAgentDraft(drafts, "Cursor", listForUser)).toBeUndefined();
  });

  it("lets go of an agent's oldest rows past its cap, and nobody else's", () => {
    const drafts = [draft("mine", NOW - 9 * DAY, { ran: true }), ...[0, 1, 2, 3, 4, 5].map((n) => draft(`a${n}`, NOW - n * DAY, { agentName: "Claude" }))];
    expect(agentOverflow(drafts, "Claude").map((candidate) => candidate.id)).toEqual(["a5"]);
  });

  it("drops the bridge an agent's name arrives through", () => {
    expect(agentLabel("claude-ai (via mcp-remote 0.16.6)")).toBe("claude-ai");
    expect(agentLabel("copilot-cli")).toBe("copilot-cli");
  });

  it("says an age in a word", () => {
    expect(shortAge(NOW - 5_000, NOW)).toBe("now");
    expect(shortAge(NOW - 4 * 60_000, NOW)).toBe("4m");
    expect(shortAge(NOW - 3 * 60 * 60_000, NOW)).toBe("3h");
  });

  // Clicking a method takes over a browsing buffer of your own, never the one an
  // agent is writing in.
  it("never reopens the agent's draft as a browsing buffer", () => {
    const agent = draft("agent", NOW, { agentName: "Claude" });
    expect(findUntouched([agent], agent.code, agent.originAppName)).toBeUndefined();
  });
});

describe("appendCall", () => {
  it("folds a second call from the same module into the existing import", () => {
    const merged = appendCall(listForUser, getRepo);

    expect(merged.match(/^import/gm)).toHaveLength(1);
    expect(merged).toContain("Repos.ListForUser({});");
    expect(merged).toContain('Repos.Get({ id: "" });');
  });

  it("adds the missing name when the module is imported but the binding isn't", () => {
    const withEnum = appendCall(listForUser, `import { Repos, Sort } from "github/service";\n\nRepos.Get({});\n`);

    expect(withEnum.match(/^import/gm)).toHaveLength(1);
    expect(withEnum).toContain("{ Repos, Sort }");
  });

  it("adds a whole import line for a module that isn't there yet", () => {
    const merged = appendCall(listForUser, sayHello);

    expect(merged.match(/^import/gm)).toHaveLength(2);
    expect(merged).toContain('from "grpcb.in"');
    expect(merged.indexOf("HelloService.SayHello")).toBeGreaterThan(merged.indexOf("Repos.ListForUser"));
  });

  it("keeps whatever the author wrote in between", () => {
    const authored = `import { Repos } from "github/service";\n\n// my note\nconst repos = Repos.ListForUser({});\n`;
    expect(appendCall(authored, getRepo)).toContain("// my note");
  });
});
