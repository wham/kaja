import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Braces, Ellipsis, Plug, Plus, RotateCw, Search, Settings, Trash2, X } from "lucide-react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { Spinner } from "./components/spinner";
import { App, Method, Service } from "./apps";
import { appType } from "./appTypes";
import { firstErrorMessage } from "./compileSummary";
import { AppTypeIcon } from "./AppTypeIcon";
import { KajaTrace } from "./KajaTrace";
import { mcpDotClass, mcpPlugClass, type McpState } from "./mcpState";
import { PHONE_ICON, PhoneLevelHeader, PhoneRow, PhoneRowAction, PhoneSection } from "./PhoneList";
import {
  AppCompileMarker,
  AppVariableMarker,
  MethodName,
  SIDEBAR_TABS,
  sidebarTabId,
  TAB_LABEL,
  UnsupportedMarker,
  type SidebarProps,
  type SidebarTab,
} from "./Sidebar";
import { unsupportedReason } from "./streaming";
import { groupServicesByPackage, hasMultiplePackages, serviceNodeId } from "./treeExpansion";
import { WorkspaceMenu } from "./WorkspaceMenu";

// Where the Apps tab has been taken: an app, then a package where the app has more than
// one, then a service. Absent is the list of apps.
interface AppsLevel {
  app: string;
  pkg?: string;
  // `serviceNodeId`, which is unique where a service's own name is not.
  service?: string;
}

/**
 * The sidebar on a phone: the desktop's band, tabs and lists, at the size a thumb and an
 * arm's length ask for, and a level at a time where the desktop draws a tree. A tree's
 * indent is the one thing a 320px drawer can't afford, and a phone's own lists are
 * walked a level at a time, so a name is never cut short by the depth it sits at.
 */
export const PhoneSidebar = memo(function PhoneSidebar({
  apps,
  tab,
  onTabChange,
  scriptsRegion,
  canUpdateWorkspace = true,
  onSelect,
  onRecompileApp,
  onNewAppClick,
  onNewScript,
  onFinderClick,
  onVariablesClick,
  variablesMissing = false,
  missingVariables,
  onRevealVariable,
  onMcpClick,
  mcpState,
  autoExpandApp,
  workspace,
  onEditApp,
  onDeleteApp,
  pendingApps = [],
  currentViewId,
  selectedApp,
  onPendingAppSelect,
  onPendingAppDiscard,
}: SidebarProps) {
  const [level, setLevel] = useState<AppsLevel | undefined>(undefined);
  const appsPane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoExpandApp) return;
    setLevel({ app: autoExpandApp.name });
    onTabChange("apps");
  }, [autoExpandApp]);

  // A level is a new page, so it opens at its top.
  useLayoutEffect(() => {
    if (appsPane.current) appsPane.current.scrollTop = 0;
  }, [level?.app, level?.pkg, level?.service]);

  // A level whose app was renamed or deleted under it is nowhere, so it reads as the top.
  const app = level ? apps.find((candidate) => candidate.configuration.name === level.app) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-chrome">
      <div className="flex h-16 shrink-0 items-center gap-2 pr-3 pl-2">
        {workspace ? (
          <WorkspaceMenu control={workspace} withMark large />
        ) : (
          <div className="flex shrink-0 select-none items-center gap-2 pl-2">
            <KajaTrace width={26} height={16} />
            <span className="text-[22px] font-semibold text-foreground">Kaja</span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {onFinderClick && <BandButton icon={<Search size={PHONE_ICON} />} label="Go to a file or call" onClick={onFinderClick} />}
          {onVariablesClick && (
            <BandButton icon={<Braces size={PHONE_ICON} />} label="Variables" onClick={onVariablesClick} dot={variablesMissing ? "bg-amber-500" : undefined} />
          )}
          {onMcpClick && mcpState && <McpBandButton state={mcpState} onClick={onMcpClick} />}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        <div
          role="tablist"
          aria-label="Sidebar"
          className="flex items-center gap-1"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const index = SIDEBAR_TABS.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1);
            const next = SIDEBAR_TABS[(index + SIDEBAR_TABS.length) % SIDEBAR_TABS.length];
            onTabChange(next);
            document.getElementById(sidebarTabId(next))?.focus();
          }}
        >
          {SIDEBAR_TABS.map((candidate) => {
            const selected = candidate === tab;
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                id={sidebarTabId(candidate)}
                aria-selected={selected}
                aria-controls={`${candidate}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(candidate)}
                className={cn(
                  "flex h-10 select-none items-center rounded-full px-4 text-[16px] outline-none focus-visible:bg-accent/50",
                  selected ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {TAB_LABEL[candidate]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          {tab === "apps"
            ? canUpdateWorkspace && <PhoneRowAction icon={Plus} label="New app" onClick={onNewAppClick} />
            : onNewScript && <PhoneRowAction icon={Plus} label="New script" onClick={onNewScript} />}
        </div>
      </div>

      <TabPane tab="apps" active={tab} paneRef={appsPane}>
        {app && level ? (
          <AppLevel
            app={app}
            level={level}
            onLevel={setLevel}
            onSelect={onSelect}
            onEditApp={onEditApp}
            settingsCurrent={selectedApp === app.configuration.name}
            onRecompileApp={onRecompileApp}
            missingVariables={missingVariables}
            onRevealVariable={onRevealVariable}
          />
        ) : (
          <nav aria-label="Apps">
            {pendingApps.map((pending) => (
              <PhoneRow
                key={pending.viewId}
                icon={pending.type ? <AppTypeIcon type={pending.type} size={PHONE_ICON} /> : <Plus size={PHONE_ICON} />}
                current={pending.viewId === currentViewId}
                onClick={() => onPendingAppSelect?.(pending.viewId)}
                trailing={
                  onPendingAppDiscard && <PhoneRowAction icon={X} label={`Discard ${pending.name}`} onClick={() => onPendingAppDiscard(pending.viewId)} />
                }
              >
                <span className="truncate italic">{pending.name}</span>
              </PhoneRow>
            ))}
            {apps.length === 0 &&
              pendingApps.length === 0 &&
              (canUpdateWorkspace ? (
                <PhoneRow icon={<Plus size={PHONE_ICON} />} onClick={onNewAppClick} className="text-muted-foreground">
                  New app
                </PhoneRow>
              ) : (
                <div className="px-3 py-2 text-[15px] text-muted-foreground">Apps named in kaja.json appear here</div>
              ))}
            {apps.map((candidate) => {
              const appName = candidate.configuration.name;
              return (
                <PhoneRow
                  key={appName}
                  icon={<AppTypeIcon type={appType(candidate.configuration)} size={PHONE_ICON} />}
                  opens
                  onClick={() => setLevel({ app: appName })}
                  trailing={
                    <AppMenu
                      appName={appName}
                      canUpdateWorkspace={canUpdateWorkspace}
                      onEditApp={onEditApp}
                      onRecompileApp={onRecompileApp}
                      onDeleteApp={onDeleteApp}
                    />
                  }
                >
                  <span className="truncate">{appName}</span>
                  <AppCompileMarker app={candidate} size={16} />
                  {onRevealVariable && <AppVariableMarker appName={appName} missing={missingVariables?.get(appName)} onReveal={onRevealVariable} size={16} />}
                </PhoneRow>
              );
            })}
          </nav>
        )}
      </TabPane>
      <TabPane tab="scripts" active={tab}>
        {scriptsRegion}
      </TabPane>
    </div>
  );
});

function AppLevel({
  app,
  level,
  onLevel,
  onSelect,
  onEditApp,
  settingsCurrent,
  onRecompileApp,
  missingVariables,
  onRevealVariable,
}: {
  app: App;
  level: AppsLevel;
  onLevel: (level: AppsLevel | undefined) => void;
  onSelect: SidebarProps["onSelect"];
  onEditApp: (appName: string) => void;
  settingsCurrent: boolean;
  onRecompileApp: (appName: string) => void;
  missingVariables?: SidebarProps["missingVariables"];
  onRevealVariable?: (name: string) => void;
}) {
  const appName = app.configuration.name;
  const packages = hasMultiplePackages(app.services);
  const service = level.service ? app.services.find((candidate) => serviceNodeId(appName, candidate) === level.service) : undefined;

  if (service) {
    return (
      <nav aria-label={`${service.name} methods`}>
        <PhoneLevelHeader
          back={packages ? service.packageName : appName}
          onBack={() => onLevel(packages ? { app: appName, pkg: service.packageName } : { app: appName })}
          title={service.name}
        />
        {service.methods.map((method) => (
          <MethodRow key={method.name} app={app} service={service} method={method} onSelect={onSelect} />
        ))}
      </nav>
    );
  }

  const compiling = app.compilation.status === "running" || app.compilation.status === "pending";
  const header = (
    <PhoneLevelHeader
      back={packages && level.pkg ? appName : "Apps"}
      onBack={() => onLevel(packages && level.pkg ? { app: appName } : undefined)}
      icon={!level.pkg ? <AppTypeIcon type={appType(app.configuration)} size={22} /> : undefined}
      title={level.pkg ?? appName}
      trailing={
        !level.pkg && (
          <>
            <AppCompileMarker app={app} size={18} />
            {onRevealVariable && <AppVariableMarker appName={appName} missing={missingVariables?.get(appName)} onReveal={onRevealVariable} size={18} />}
          </>
        )
      }
    />
  );

  // The app's own settings are a row of its level, as everything else you can be at is.
  const settings = !level.pkg && (
    <PhoneRow icon={<Settings size={PHONE_ICON} />} current={settingsCurrent} onClick={() => onEditApp(appName)}>
      Settings
    </PhoneRow>
  );

  if (compiling) {
    return (
      <nav aria-label={appName}>
        {header}
        {settings}
        <div className="flex min-h-11 items-center gap-3 px-3 text-[17px] text-muted-foreground">
          <Spinner className="size-5" />
          Compiling…
        </div>
      </nav>
    );
  }

  if (packages && !level.pkg) {
    return (
      <nav aria-label={appName}>
        {header}
        {settings}
        <PhoneSection>Packages</PhoneSection>
        {groupServicesByPackage(app.services).map(([packageName]) => (
          <PhoneRow key={packageName} opens onClick={() => onLevel({ app: appName, pkg: packageName })}>
            <span className="truncate">{packageName}</span>
          </PhoneRow>
        ))}
      </nav>
    );
  }

  const services = level.pkg ? app.services.filter((candidate) => candidate.packageName === level.pkg) : app.services;
  return (
    <nav aria-label={appName}>
      {header}
      {settings}
      {services.length > 0 && <PhoneSection>Services</PhoneSection>}
      {services.map((candidate) => {
        const id = serviceNodeId(appName, candidate);
        return (
          <PhoneRow key={id} opens onClick={() => onLevel({ ...level, service: id })}>
            <span className="truncate">{candidate.name}</span>
          </PhoneRow>
        );
      })}
      {services.length === 0 && app.compilation.status === "error" && (
        <>
          {/* A phone has no hover for the marker's tooltip, so the reason is stated. */}
          <p className="px-3 py-2 text-[15px] break-words text-destructive">{firstErrorMessage(app) ?? "Compilation failed"}</p>
          <PhoneRow icon={<RotateCw size={PHONE_ICON} />} onClick={() => onRecompileApp(appName)}>
            Recompile
          </PhoneRow>
        </>
      )}
    </nav>
  );
}

function MethodRow({ app, service, method, onSelect }: { app: App; service: Service; method: Method; onSelect: SidebarProps["onSelect"] }) {
  const unsupported = unsupportedReason(method, appType(app.configuration));
  return (
    <PhoneRow
      onClick={() => onSelect(method, service, app)}
      trailing={
        unsupported && (
          <span className="flex size-9 shrink-0 items-center justify-center">
            <UnsupportedMarker reason={unsupported} size={18} />
          </span>
        )
      }
    >
      <span className="truncate">
        <MethodName name={method.name} unsupported={!!unsupported} deprecated={!!method.deprecated} />
      </span>
    </PhoneRow>
  );
}

function AppMenu({
  appName,
  canUpdateWorkspace,
  onEditApp,
  onRecompileApp,
  onDeleteApp,
}: {
  appName: string;
  canUpdateWorkspace: boolean;
  onEditApp: (appName: string) => void;
  onRecompileApp: (appName: string) => void;
  onDeleteApp: (appName: string) => void;
}) {
  return (
    // The row opens the app, so a tap on its menu must not also reach the row.
    <span className="flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${appName}`}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
          >
            <Ellipsis size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => onEditApp(appName)}>
            <Settings size={16} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRecompileApp(appName)}>
            <RotateCw size={16} />
            Recompile
          </DropdownMenuItem>
          {canUpdateWorkspace && (
            <DropdownMenuItem variant="danger" onSelect={() => onDeleteApp(appName)}>
              <Trash2 size={16} />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

// The round buttons a phone's own top bar carries.
const BAND_BUTTON =
  "relative flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-foreground outline-none active:bg-accent";

function BandButton({ icon, label, onClick, dot }: { icon: React.ReactNode; label: string; onClick: () => void; dot?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={BAND_BUTTON}>
      {icon}
      {dot && <span aria-hidden className={cn("pointer-events-none absolute top-2 right-2 size-[7px] rounded-full", dot)} />}
    </button>
  );
}

// The desktop band's plug, with the same two marks: the dot for on, the ring for in use.
function McpBandButton({ state, onClick }: { state: McpState; onClick: () => void }) {
  const dot = mcpDotClass(state);
  return (
    <button type="button" aria-label="MCP server" onClick={onClick} className={cn(BAND_BUTTON, mcpPlugClass(state))}>
      {state === "active" && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-full border border-emerald-500/70 animate-signal motion-reduce:animate-none motion-reduce:opacity-60"
        />
      )}
      <Plug size={PHONE_ICON} />
      {dot && <span aria-hidden className={cn("pointer-events-none absolute top-2 right-2 size-[7px] rounded-full", dot)} />}
    </button>
  );
}

// Both stay mounted, so a level, a menu or a name being typed survives a switch.
function TabPane({
  tab,
  active,
  paneRef,
  children,
}: {
  tab: SidebarTab;
  active: SidebarTab;
  paneRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={paneRef}
      role="tabpanel"
      id={`${tab}-panel`}
      aria-labelledby={sidebarTabId(tab)}
      hidden={tab !== active}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
    >
      {children}
    </div>
  );
}
