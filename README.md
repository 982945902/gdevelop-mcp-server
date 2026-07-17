# GDevelop MCP Server

This package gives Codex a local control plane for the existing GDevelop
exporter. It does not reimplement the game runtime: `libGD.js` loads a project,
`gd.Exporter` generates a GDJS preview, and a loopback-only HTTP server exposes
the generated files to a browser. See [ARCHITECTURE.md](./ARCHITECTURE.md) for
the C++/Wasm, MCP, AI, and browser Runtime boundaries.

This is an independent, unofficial integration. GDevelop and its logo are the
property of their respective owner.

## Tools

- `open_project` loads a project JSON file and returns a session ID and scenes.
- `build_preview` exports one scene, serves it, and returns an HTTP URL.
- `get_preview_status` lists or inspects preview sessions.
- `stop_preview` stops the server and removes that preview's temporary files.
- `close_project` stops related previews and releases the Wasm project handle.

## Install and run

```sh
git clone https://github.com/982945902/gdevelop-mcp-server.git
cd gdevelop-mcp-server
npm ci
npm start
```

The MCP server uses GDevelop's existing engine artifacts rather than vendoring
them. Point `GDEVELOP_ROOT` at a prepared GDevelop source checkout and the
server auto-detects artifacts in this order:

- locally built `Binaries/embuild/GDevelop.js/libGD.js`, then the IDE-imported
  `newIDE/app/node_modules/libGD.js-for-tests-only/index.js` or
  `newIDE/app/public/libGD.js`;
- `newIDE/app/resources/GDJS`, then
  `newIDE/app/node_modules/GDJS-for-web-app-only`.

For a fresh GDevelop checkout, prepare the same artifacts used by the editor:

```sh
git clone https://github.com/4ian/GDevelop.git
cd GDevelop/newIDE/app
npm install
```

The app's postinstall installs GDJS dependencies, downloads the matching
prebuilt `libGD.js`, and builds the GDJS Runtime and extensions. A locally built
`Binaries/embuild/GDevelop.js/libGD.js` takes precedence when present.

Alternatively, set `GDEVELOP_LIBGD_PATH` and `GDEVELOP_GDJS_ROOT` explicitly
when using artifacts from another build or a packaged GDevelop distribution.
Explicit paths take precedence over `GDEVELOP_ROOT`. Set
`GDEVELOP_LOAD_EXTENSIONS=false` only for focused tests whose projects do not
use standard GDJS object/behavior extensions.

## Codex configuration

Put this in a trusted project's `.codex/config.toml`, using absolute paths:

```toml
[mcp_servers.gdevelop]
command = "node"
args = ["/absolute/path/to/gdevelop-mcp-server/src/index.js"]

[mcp_servers.gdevelop.env]
GDEVELOP_ROOT = "/absolute/path/to/GDevelop"
```

The same block is available in `codex.config.toml.example`.

Restart Codex after changing MCP configuration. The intended loop is:

1. Call `open_project` with the game JSON path.
2. Call `build_preview` with the returned `projectId` and an optional scene.
3. Open the returned URL with Codex's browser capability to inspect, screenshot,
   and debug the generated runtime.
4. Call `stop_preview`, then `close_project`, when finished.

The server binds only to `127.0.0.1` and uses a random port. Export jobs are
serialized because the shared C++/Wasm platform and extension registries are
process-global. For remote deployment, add a Streamable HTTP transport plus
authentication and per-user process/session isolation; do not expose this local
stdio server directly to the public internet.

## Verification

Fast tests use an in-process fake exporter but exercise the actual MCP protocol,
HTTP server, lifecycle cleanup, and path traversal protection:

```sh
npm test
```

Run the opt-in test with real, matching GDevelop artifacts and a project:

```sh
GDEVELOP_LIBGD_PATH=/absolute/path/to/libGD.js \
GDEVELOP_GDJS_ROOT=/absolute/path/to/built/GDJS \
GDEVELOP_TEST_PROJECT=/absolute/path/to/game.json \
npm run test:runtime
```
