import os from "node:os";
import fs from "node:fs";
import path from "node:path";

import { GDevelopRuntime } from "./gdevelop-runtime.js";
import { createMcpServer } from "./mcp-server.js";
import { PreviewSessionManager } from "./preview-session-manager.js";
import { ProjectSessionManager } from "./project-session-manager.js";

const firstExistingPath = (candidates) =>
  candidates.find((candidate) => fs.existsSync(candidate));

const gdevelopRoot = process.env.GDEVELOP_ROOT
  ? path.resolve(process.env.GDEVELOP_ROOT)
  : null;

const libGDCandidates = gdevelopRoot
  ? [
      path.join(gdevelopRoot, "Binaries", "embuild", "GDevelop.js", "libGD.js"),
      path.join(
        gdevelopRoot,
        "newIDE",
        "app",
        "node_modules",
        "libGD.js-for-tests-only",
        "index.js",
      ),
      path.join(gdevelopRoot, "newIDE", "app", "public", "libGD.js"),
    ]
  : [];
const gdjsCandidates = gdevelopRoot
  ? [
      path.join(gdevelopRoot, "newIDE", "app", "resources", "GDJS"),
      path.join(
        gdevelopRoot,
        "newIDE",
        "app",
        "node_modules",
        "GDJS-for-web-app-only",
      ),
    ]
  : [];

export const defaultConfig = {
  libGDPath:
    process.env.GDEVELOP_LIBGD_PATH || firstExistingPath(libGDCandidates),
  gdjsRoot: process.env.GDEVELOP_GDJS_ROOT || firstExistingPath(gdjsCandidates),
  tempRoot:
    process.env.GDEVELOP_MCP_TEMP_ROOT ||
    path.join(os.tmpdir(), "gdevelop-mcp"),
  loadExtensions: process.env.GDEVELOP_LOAD_EXTENSIONS !== "false",
};

export const createGDevelopMcpApp = ({
  runtime = new GDevelopRuntime(defaultConfig),
  tempRoot = defaultConfig.tempRoot,
  serverFactory,
} = {}) => {
  const projects = new ProjectSessionManager({ runtime });
  const previews = new PreviewSessionManager({
    runtime,
    projects,
    tempRoot,
    serverFactory,
  });
  const server = createMcpServer({ projects, previews });
  return {
    server,
    runtime,
    projects,
    previews,
    async close() {
      await previews.closeAll();
      projects.closeAll();
      if (server.isConnected()) await server.close();
    },
  };
};
