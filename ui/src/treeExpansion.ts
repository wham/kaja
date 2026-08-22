import { Method, Service } from "./apps";
import { getPersistedValue, setPersistedValue } from "./storage";

/**
 * What the sidebar tree opens with. Expansion is a record of where you have been, not
 * a guess about where you will go: the calls you have made, the nodes you have folded
 * yourself, and — only before either can say anything — how much of an app fits.
 */

// A fold is a decision, an expansion is a suggestion: nothing derived here ever
// reopens a node you closed. A node never touched is absent, and absent is the only
// state a seed may write into.
export type Fold = "open" | "shut";

export interface FoldMap {
  [nodeId: string]: Fold;
}

export interface TreeApp {
  name: string;
  services: Service[];
}

// Only recency is kept — the list is ordered, so there is no timestamp and no count.
export interface MethodUse {
  app: string;
  package: string;
  service: string;
  method: string;
}

// How many recent calls get the path to them opened. Past three the tree becomes a
// list of everything you have ever run.
const RECENT_PATHS = 3;
// Rows an app may open to when its size is all there is to go on.
const AUTO_ROWS = 12;
// The ledger is recency, so its tail is dead weight rather than history.
const LEDGER_LIMIT = 200;
const LEDGER_KEY = "methodUses";

export function appNodeId(appName: string): string {
  return `app:${appName}`;
}

export function packageNodeId(appName: string, packageName: string): string {
  return `pkg:${appName}/${packageName}`;
}

export function serviceNodeId(appName: string, service: Service): string {
  return `svc:${appName}/${service.packageName}.${service.name}`;
}

export function hasMultiplePackages(services: Service[]): boolean {
  if (services.length === 0) return false;
  const first = services[0].packageName;
  return services.some((service) => service.packageName !== first);
}

export function groupServicesByPackage(services: Service[]): [string, Service[]][] {
  const groups = new Map<string, Service[]>();
  for (const service of services) {
    const existing = groups.get(service.packageName);
    if (existing) existing.push(service);
    else groups.set(service.packageName, [service]);
  }
  return [...groups.entries()];
}

export function isOpen(folds: FoldMap, nodeId: string): boolean {
  return folds[nodeId] === "open";
}

// Levels below an app, outermost first: packages only exist as a level when the app
// has more than one.
function levelSizes(app: TreeApp): number[] {
  const services = app.services.length;
  const methods = app.services.reduce((total, service) => total + service.methods.length, 0);
  if (!hasMultiplePackages(app.services)) return [services, methods];
  return [groupServicesByPackage(app.services).length, services, methods];
}

// Rows the tree shows under an app opened `depth` levels deep.
function rowsAtDepth(app: TreeApp, depth: number): number {
  return levelSizes(app)
    .slice(0, depth)
    .reduce((total, size) => total + size, 0);
}

// A level opens whole or not at all, which is what keeps this from picking one
// service out of a list.
function nodesAtDepth(app: TreeApp, depth: number): string[] {
  if (depth < 1) return [];
  const nodes = [appNodeId(app.name)];
  const multiple = hasMultiplePackages(app.services);
  if (depth >= 2) {
    if (multiple) nodes.push(...groupServicesByPackage(app.services).map(([packageName]) => packageNodeId(app.name, packageName)));
    else nodes.push(...app.services.map((service) => serviceNodeId(app.name, service)));
  }
  if (depth >= 3 && multiple) nodes.push(...app.services.map((service) => serviceNodeId(app.name, service)));
  return nodes;
}

/**
 * How far into an app to open when nothing is known about it: as deep as it goes while
 * staying inside `budget` rows, and never less than its first level, so a new app
 * always says what is in it.
 */
export function autoOpenNodes(app: TreeApp, budget: number = AUTO_ROWS): string[] {
  for (let depth = levelSizes(app).length; depth > 1; depth--) {
    if (rowsAtDepth(app, depth) <= budget) return nodesAtDepth(app, depth);
  }
  return nodesAtDepth(app, 1);
}

/**
 * The nodes between an app and one of its methods, or undefined when the call no
 * longer exists — a ledger entry outlives the proto that named it.
 */
export function usePath(app: TreeApp, use: MethodUse): string[] | undefined {
  const service = app.services.find((candidate) => candidate.name === use.service && candidate.packageName === use.package);
  if (!service || !service.methods.some((method) => method.name === use.method)) return undefined;
  const path = [appNodeId(app.name)];
  if (hasMultiplePackages(app.services)) path.push(packageNodeId(app.name, service.packageName));
  path.push(serviceNodeId(app.name, service));
  return path;
}

/**
 * Everything under a node, for the ⌥click that takes a whole subtree at once. It is
 * fold-all and unfold-all scoped to where the cursor already is, which is what let the
 * two header buttons go.
 */
export function subtreeNodes(app: TreeApp, nodeId: string): string[] {
  if (nodeId === appNodeId(app.name)) {
    const nodes = hasMultiplePackages(app.services) ? groupServicesByPackage(app.services).map(([name]) => packageNodeId(app.name, name)) : [];
    return [...nodes, ...app.services.map((service) => serviceNodeId(app.name, service))];
  }
  for (const [packageName, services] of groupServicesByPackage(app.services)) {
    if (nodeId === packageNodeId(app.name, packageName)) return services.map((service) => serviceNodeId(app.name, service));
  }
  return [];
}

/**
 * What the apps in `targets` open with. Apps compile at their own pace, so this seeds
 * some of them against all of them: the recent-call budget is spent globally, and
 * whether this is a cold start is asked of the whole tree.
 *
 * An app the ledger cannot speak for stays shut — once there is a history, silence
 * about an app means you don't use it. An app newer than the ledger has nothing to be
 * silent with, so it falls back to its size.
 */
export function seedFolds(apps: TreeApp[], targets: ReadonlySet<string>, folds: FoldMap, ledger: MethodUse[], newApps: ReadonlySet<string>): FoldMap {
  const next = { ...folds };
  const open = (nodeId: string) => {
    if (next[nodeId] === undefined) next[nodeId] = "open";
  };

  const spokenFor = new Set<string>();
  let paths = 0;
  for (const use of ledger) {
    if (paths >= RECENT_PATHS) break;
    const app = apps.find((candidate) => candidate.name === use.app);
    if (!app) continue;
    const path = usePath(app, use);
    if (!path) continue;
    // Paths into apps seeded earlier still spend the budget: they are open, and three is
    // meant to be three across the tree.
    paths++;
    spokenFor.add(app.name);
    if (targets.has(app.name)) path.forEach(open);
  }

  const coldStart = paths === 0;
  for (const app of apps) {
    if (!targets.has(app.name) || spokenFor.has(app.name)) continue;
    if (!coldStart && !newApps.has(app.name)) continue;
    autoOpenNodes(app).forEach(open);
  }

  return next;
}

/**
 * Drop folds for nodes that no longer exist. An app still compiling has nothing to
 * match against, so its subtree is left alone rather than cleared and re-seeded on
 * every reload.
 */
export function pruneFolds(folds: FoldMap, apps: TreeApp[], compiling: ReadonlySet<string>): FoldMap {
  const live = new Set<string>();
  const spared: string[] = [];
  for (const app of apps) {
    live.add(appNodeId(app.name));
    if (compiling.has(app.name) || app.services.length === 0) spared.push(`pkg:${app.name}/`, `svc:${app.name}/`);
    if (hasMultiplePackages(app.services)) {
      for (const [packageName] of groupServicesByPackage(app.services)) live.add(packageNodeId(app.name, packageName));
    }
    for (const service of app.services) live.add(serviceNodeId(app.name, service));
  }

  const kept: FoldMap = {};
  for (const [nodeId, fold] of Object.entries(folds)) {
    if (live.has(nodeId) || spared.some((prefix) => nodeId.startsWith(prefix))) kept[nodeId] = fold;
  }
  return Object.keys(kept).length === Object.keys(folds).length ? folds : kept;
}

export function methodUse(appName: string, service: Service, method: Method): MethodUse {
  return { app: appName, package: service.packageName, service: service.name, method: method.name };
}

function sameUse(a: MethodUse, b: MethodUse): boolean {
  return a.app === b.app && a.package === b.package && a.service === b.service && a.method === b.method;
}

export function withUse(ledger: MethodUse[], use: MethodUse): MethodUse[] {
  if (ledger.length > 0 && sameUse(ledger[0], use)) return ledger;
  return [use, ...ledger.filter((entry) => !sameUse(entry, use))].slice(0, LEDGER_LIMIT);
}

export function loadLedger(): MethodUse[] {
  const stored = getPersistedValue<MethodUse[]>(LEDGER_KEY);
  return Array.isArray(stored) ? stored : [];
}

/**
 * Record a call, from the tree, the finder, or a script that ran it. A method call
 * reports itself many times over while it streams, so a use already at the front
 * writes nothing.
 */
export function recordUse(use: MethodUse): void {
  const ledger = loadLedger();
  const next = withUse(ledger, use);
  if (next !== ledger) setPersistedValue(LEDGER_KEY, next);
}

export function loadFolds(): FoldMap {
  const stored = getPersistedValue<FoldMap>("treeFolds");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const folds: FoldMap = {};
  for (const [nodeId, fold] of Object.entries(stored)) {
    if (fold === "open" || fold === "shut") folds[nodeId] = fold;
  }
  return folds;
}

export function saveFolds(folds: FoldMap): void {
  setPersistedValue("treeFolds", folds);
}
