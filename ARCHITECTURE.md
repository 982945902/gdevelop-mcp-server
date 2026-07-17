# Architecture

## Responsibilities

The AI does more than write a schema, and it does not execute the game itself:

```text
Codex
  -> MCP tool call (validated JSON input)
  -> project/preview session orchestration
  -> libGD.js (C++ compiled to Wasm: project model, serialization, codegen)
  -> generated GDJS files
  -> browser Runtime (game execution and rendering)
```

- Codex decides which operation to call and supplies structured arguments.
- MCP defines the safe, observable control surface and owns session lifecycle.
- C++/Wasm remains the source of truth for the editor domain model and preview
  code generation.
- GDJS Runtime executes the generated game in the browser.

This boundary means an AI can later add or modify scenes, objects, events, and
resources through typed tools without needing to generate GDevelop's complete
serialized project format by hand.

## Import split

The headless path deliberately does not import `LocalPreviewLauncher`, React,
Electron, Pixi editor renderers, or the large `EditorFunctions` module.

- `gdevelop-runtime.js` knows only libGD/GDJS and the exporter API.
- `node-file-system.js` implements the filesystem interface required by C++.
- `project-session-manager.js` owns Wasm project handles.
- `preview-session-manager.js` owns builds, URLs, servers, and cleanup.
- `mcp-server.js` owns tool schemas and maps calls onto those services.
- `static-preview-server.js` is an independently testable loopback server.

Future editor mutation tools should follow the same split:

1. Put reusable operations such as create-object or edit-event into a headless
   command layer that accepts explicit `gd`, project, and arguments.
2. Keep UI rendering, dialogs, analytics, and React state in the IDE adapters.
3. Register thin MCP tools that validate input and invoke the command layer.
4. Return stable JSON snapshots or IDs, never raw Embind/Wasm handles.

## Process and safety model

One MCP process owns one libGD instance. Exports are serialized because GDevelop
platform and extension registries are process-global. Each preview receives a
random temporary directory and a loopback-only random HTTP port. Cleanup checks
that the directory is below the configured MCP temporary root before removal.

STDIO is the deployment target for local Codex usage. A remote deployment needs
an authenticated Streamable HTTP transport and process-level tenant isolation;
the loopback preview server must not be exposed as a public multi-tenant service.
