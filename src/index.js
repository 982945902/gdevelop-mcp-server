#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createGDevelopMcpApp, defaultConfig } from "./app.js";

const app = createGDevelopMcpApp();
let shuttingDown = false;

const shutdown = async (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
  } finally {
    process.exit(exitCode);
  }
};

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

try {
  // Stdout belongs exclusively to the MCP stdio transport.
  console.error(
    `[gdevelop-mcp] libGD=${defaultConfig.libGDPath} GDJS=${defaultConfig.gdjsRoot}`,
  );
  await app.server.connect(new StdioServerTransport());
} catch (error) {
  console.error("[gdevelop-mcp] Failed to start:", error);
  await shutdown(1);
}
