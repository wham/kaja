import { describe, expect, test } from "bun:test";
import { Service } from "./apps";
import {
  appNodeId,
  autoOpenNodes,
  FoldMap,
  MethodUse,
  packageNodeId,
  pruneFolds,
  seedFolds,
  serviceNodeId,
  subtreeNodes,
  TreeApp,
  usePath,
  withUse,
} from "./treeExpansion";

function service(name: string, packageName: string, methods: string[]): Service {
  return {
    name,
    packageName,
    sourcePath: `${packageName}.proto`,
    clientStubModuleId: `${packageName}.${name}`,
    methods: methods.map((method) => ({ name: method })),
  };
}

function methods(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

const tiny: TreeApp = { name: "tiny", services: [service("Shows", "theatre", ["ListShows", "GetShow"])] };

const medium: TreeApp = {
  name: "medium",
  services: [service("Shows", "theatre", methods("M", 6)), service("Seats", "theatre", methods("N", 6)), service("Venues", "theatre", methods("O", 6))],
};

const huge: TreeApp = {
  name: "huge",
  services: Array.from({ length: 40 }, (_, index) => service(`Service${index}`, "big", methods("M", 5))),
};

const packaged: TreeApp = {
  name: "packaged",
  services: [service("Shows", "theatre", ["ListShows"]), service("Seats", "seating", ["Reserve"])],
};

const use = (app: string, pkg: string, svc: string, method: string): MethodUse => ({ app, package: pkg, service: svc, method });

describe("autoOpenNodes", () => {
  test("opens a small app all the way to its methods", () => {
    expect(autoOpenNodes(tiny)).toEqual([appNodeId("tiny"), serviceNodeId("tiny", tiny.services[0])]);
  });

  test("stops at the service list when opening every service would not fit", () => {
    // 3 services fit; 3 services plus their 18 methods do not.
    expect(autoOpenNodes(medium)).toEqual([appNodeId("medium")]);
  });

  test("opens the app itself even when its first level overflows", () => {
    expect(autoOpenNodes(huge)).toEqual([appNodeId("huge")]);
  });

  test("counts packages as their own level", () => {
    expect(autoOpenNodes(packaged)).toEqual([
      appNodeId("packaged"),
      packageNodeId("packaged", "theatre"),
      packageNodeId("packaged", "seating"),
      serviceNodeId("packaged", packaged.services[0]),
      serviceNodeId("packaged", packaged.services[1]),
    ]);
  });

  test("never opens a level part way", () => {
    // A budget that fits two of the three services opens none of them.
    expect(autoOpenNodes(medium, 4)).toEqual([appNodeId("medium")]);
  });
});

describe("usePath", () => {
  test("resolves to the nodes between the app and the service", () => {
    expect(usePath(packaged, use("packaged", "seating", "Seats", "Reserve"))).toEqual([
      appNodeId("packaged"),
      packageNodeId("packaged", "seating"),
      serviceNodeId("packaged", packaged.services[1]),
    ]);
  });

  test("omits the package level when there is only one package", () => {
    expect(usePath(tiny, use("tiny", "theatre", "Shows", "GetShow"))).toEqual([appNodeId("tiny"), serviceNodeId("tiny", tiny.services[0])]);
  });

  test("does not resolve a call the proto no longer has", () => {
    expect(usePath(tiny, use("tiny", "theatre", "Shows", "DeleteShow"))).toBeUndefined();
    expect(usePath(tiny, use("tiny", "theatre", "Gone", "GetShow"))).toBeUndefined();
    expect(usePath(tiny, use("tiny", "elsewhere", "Shows", "GetShow"))).toBeUndefined();
  });
});

describe("seedFolds", () => {
  const all = (apps: TreeApp[]) => new Set(apps.map((app) => app.name));
  const none = new Set<string>();

  test("a cold start goes by size, for every app", () => {
    const apps = [tiny, medium];
    const folds = seedFolds(apps, all(apps), {}, [], none);
    expect(folds[appNodeId("tiny")]).toBe("open");
    expect(folds[serviceNodeId("tiny", tiny.services[0])]).toBe("open");
    expect(folds[appNodeId("medium")]).toBe("open");
    expect(folds[serviceNodeId("medium", medium.services[0])]).toBeUndefined();
  });

  test("with a history, the recent calls decide", () => {
    const apps = [tiny, medium];
    const ledger = [use("medium", "theatre", "Venues", "O1")];
    const folds = seedFolds(apps, all(apps), {}, ledger, none);
    expect(folds[appNodeId("medium")]).toBe("open");
    expect(folds[serviceNodeId("medium", medium.services[2])]).toBe("open");
  });

  test("an app no recent call names stays shut", () => {
    const apps = [tiny, medium];
    const folds = seedFolds(apps, all(apps), {}, [use("medium", "theatre", "Venues", "O1")], none);
    expect(folds[appNodeId("tiny")]).toBeUndefined();
  });

  test("opens at most three paths", () => {
    const apps = [huge];
    const ledger = huge.services.slice(0, 5).map((svc) => use("huge", "big", svc.name, "M1"));
    const folds = seedFolds(apps, all(apps), {}, ledger, none);
    const open = huge.services.filter((svc) => folds[serviceNodeId("huge", svc)] === "open");
    expect(open.map((svc) => svc.name)).toEqual(["Service0", "Service1", "Service2"]);
  });

  test("a call the proto no longer has does not spend the budget", () => {
    const apps = [huge];
    const ledger = [use("huge", "big", "Deleted", "M1"), ...huge.services.slice(0, 3).map((svc) => use("huge", "big", svc.name, "M1"))];
    const folds = seedFolds(apps, all(apps), {}, ledger, none);
    expect(huge.services.filter((svc) => folds[serviceNodeId("huge", svc)] === "open")).toHaveLength(3);
  });

  test("a ledger that resolves to nothing at all is a cold start", () => {
    const apps = [tiny];
    const folds = seedFolds(apps, all(apps), {}, [use("deleted-app", "theatre", "Shows", "GetShow")], none);
    expect(folds[serviceNodeId("tiny", tiny.services[0])]).toBe("open");
  });

  test("a new app goes by size even when there is a history", () => {
    const apps = [tiny, medium];
    const ledger = [use("medium", "theatre", "Venues", "O1")];
    const folds = seedFolds(apps, all(apps), {}, ledger, new Set(["tiny"]));
    expect(folds[serviceNodeId("tiny", tiny.services[0])]).toBe("open");
  });

  test("never reopens a node that was folded by hand", () => {
    const apps = [tiny];
    const shut: FoldMap = { [serviceNodeId("tiny", tiny.services[0])]: "shut" };
    expect(seedFolds(apps, all(apps), shut, [], none)[serviceNodeId("tiny", tiny.services[0])]).toBe("shut");
    const ledger = [use("tiny", "theatre", "Shows", "GetShow")];
    expect(seedFolds(apps, all(apps), shut, ledger, none)[serviceNodeId("tiny", tiny.services[0])]).toBe("shut");
  });

  test("seeds only its targets, but spends the budget on every app", () => {
    const apps = [tiny, medium];
    const ledger = [use("tiny", "theatre", "Shows", "GetShow"), use("medium", "theatre", "Venues", "O1")];
    const folds = seedFolds(apps, new Set(["medium"]), {}, ledger, none);
    expect(folds[appNodeId("tiny")]).toBeUndefined();
    expect(folds[serviceNodeId("medium", medium.services[2])]).toBe("open");
  });
});

describe("pruneFolds", () => {
  test("drops nodes that are gone and keeps the rest", () => {
    const folds: FoldMap = {
      [appNodeId("tiny")]: "open",
      [serviceNodeId("tiny", tiny.services[0])]: "open",
      [serviceNodeId("tiny", service("Removed", "theatre", []))]: "shut",
      [appNodeId("deleted")]: "open",
    };
    const pruned = pruneFolds(folds, [tiny], new Set());
    expect(Object.keys(pruned).sort()).toEqual([appNodeId("tiny"), serviceNodeId("tiny", tiny.services[0])].sort());
  });

  test("leaves an app with nothing to match against alone", () => {
    const uncompiled: TreeApp = { name: "tiny", services: [] };
    const folds: FoldMap = { [serviceNodeId("tiny", tiny.services[0])]: "shut" };
    expect(pruneFolds(folds, [uncompiled], new Set(["tiny"]))).toEqual(folds);
    expect(pruneFolds(folds, [uncompiled], new Set())).toEqual(folds);
  });

  test("still drops a service its app no longer compiles", () => {
    const folds: FoldMap = { [serviceNodeId("tiny", service("Removed", "theatre", []))]: "shut" };
    expect(pruneFolds(folds, [tiny], new Set())).toEqual({});
  });

  test("returns the same object when nothing is stale", () => {
    const folds: FoldMap = { [appNodeId("tiny")]: "open" };
    expect(pruneFolds(folds, [tiny], new Set())).toBe(folds);
  });
});

describe("subtreeNodes", () => {
  test("an app takes its packages and its services", () => {
    expect(subtreeNodes(packaged, appNodeId("packaged"))).toEqual([
      packageNodeId("packaged", "theatre"),
      packageNodeId("packaged", "seating"),
      serviceNodeId("packaged", packaged.services[0]),
      serviceNodeId("packaged", packaged.services[1]),
    ]);
  });

  test("a package takes only its own services", () => {
    expect(subtreeNodes(packaged, packageNodeId("packaged", "seating"))).toEqual([serviceNodeId("packaged", packaged.services[1])]);
  });

  test("a service has nothing under it but leaves", () => {
    expect(subtreeNodes(tiny, serviceNodeId("tiny", tiny.services[0]))).toEqual([]);
  });
});

describe("withUse", () => {
  test("moves a call to the front without repeating it", () => {
    const a = use("app", "pkg", "Svc", "A");
    const b = use("app", "pkg", "Svc", "B");
    expect(withUse([b, a], a)).toEqual([a, b]);
  });

  test("writes nothing when the call is already the most recent", () => {
    const a = use("app", "pkg", "Svc", "A");
    const ledger = [a, use("app", "pkg", "Svc", "B")];
    expect(withUse(ledger, { ...a })).toBe(ledger);
  });

  test("caps the tail", () => {
    const ledger = Array.from({ length: 200 }, (_, index) => use("app", "pkg", "Svc", `M${index}`));
    expect(withUse(ledger, use("app", "pkg", "Svc", "New"))).toHaveLength(200);
  });
});
