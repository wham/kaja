## Scripts

One global, flat scripts directory next to `kaja.json` (`<kajaHome>/scripts/`, desktop only). Wails `ListScripts` reads its `*.ts` files; the sidebar shows them in a top-level "Scripts" section with `FileCodeIcon`. Clicking opens a `ScriptTab` (own tab type, file-backed). Open scripts auto-save to disk (debounced via `WriteScriptFile`) — no ⌘S, no dirty marker. Scripts bind to a project at run time via their import paths, so they aren't tied to a project. ⌘S on any editor (a method or a script) prompts for a name and saves the current contents as a new script via `CreateScript`.

## macOS "Run Kaja Script" text service

Select text in any macOS app, right-click → Services → "Run Kaja Script". The app registers a Services provider (`desktop/services_darwin.go`, declared via `NSServices` in `Info.plist`) that hands the selected text to the UI as a `service:runScript` Wails event. The UI runs the *pinned* script with the text exposed as `kaja.input`. Pin a script via its right-click menu in the sidebar ("Pin to context menu"); the pinned path persists in UI state. macOS-desktop only.

## Resources

```json
{
  "projects": [
    {
      "name": "grpc-quirks",
      "protocol": "RPC_PROTOCOL_GRPC",
      "url": "dns:kaja.tools:443",
      "protoDir": "quirks/proto",
      "headers": {
        "X-Yolo": "kaja123",
        "Authorization": "Bear brown"
      }
    },
    {
      "name": "twirp-quirks",
      "protocol": "RPC_PROTOCOL_TWIRP",
      "url": "https://kaja.tools/twirp-quirks",
      "protoDir": "quirks/proto",
      "headers": {
        "X-Yolo": "kaja123",
        "Authorization": "Bear brown"
      }
    },
    {
      "name": "grpcb.in",
      "protocol": "RPC_PROTOCOL_GRPC",
      "url": "grpc://grpcb.in:9000",
      "protoDir": "grpcbin/proto"
    },
    {
      "name": "teams",
      "protocol": "RPC_PROTOCOL_GRPC",
      "url": "dns:kaja.tools:443",
      "protoDir": "teams/proto",
      "useReflection": true
    },
    {
      "name": "users",
      "protocol": "RPC_PROTOCOL_TWIRP",
      "url": "https://kaja.tools/users",
      "protoDir": "users/proto"
    }
  ],
  "system": {
    "canUpdateConfiguration": true
  }
}
```

`open ~/Library/Application\ Support/kaja/`

https://www.opencollection.com