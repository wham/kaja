# Kaja for agents

Kaja is a desktop client for gRPC and Twirp services. It lets you invoke any
method of any configured service and write small **TypeScript scripts** that
orchestrate several calls together. This MCP server lets you read, write, and
run those scripts on the user's behalf.

## How a script works

A script is a TypeScript file in the global `scripts/` folder. It imports the
services it needs and calls their methods. Imports bind to a configured app
by the app's name, which is the first path segment:

```ts
import { Users } from "users/";
import { Teams } from "teams/";

const user = await Users.GetUser({ id: 42 });
const team = await Teams.GetTeam({ id: user.team_id });
console.log(team);
```

Rules that matter:

- Every method call returns a `Promise`; always `await` it.
- The import name (`Users`) must be a service exposed by the app whose name
  matches the first path segment of the import (`"users/"` → app `users`).
- Call `list_services` to discover the exact apps, services, methods, and
  request/response field types that are available right now. Read the generated
  `.ts` stubs (exposed as resources) for precise field-level types.
- The body is wrapped in an `async` function, so top-level `await` is fine.
- Use `console.log(...)` to surface values; the output is returned to you when
  you run the script.

## The `kaja` runtime object

Scripts can import a `kaja` object with `import { kaja } from "kaja";`:

- `kaja.input?: string` — text supplied when the script is launched from the
  macOS "Run Kaja Script" text service. `undefined` when run any other way.
- `kaja.ask(message: string): Promise<string>` — pause and prompt the user for
  input in a dialog. Resolves with the entered text; if the user cancels, the
  script quietly stops. Avoid `kaja.ask` in scripts you run via MCP unless the
  user is present, since it blocks on a human.

## Working effectively

1. Start from `list_services` to learn what is callable.
2. Read or list existing scripts before writing new ones; reuse patterns.
3. Keep scripts small and composable; one task per script.
4. After `run_script`, inspect the returned console output and the per-call
   request/response log to verify the result before reporting back.
