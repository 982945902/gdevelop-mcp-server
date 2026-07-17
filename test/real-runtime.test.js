import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createGDevelopMcpApp } from "../src/app.js";
import { GDevelopRuntime } from "../src/gdevelop-runtime.js";

const config = {
  libGDPath: process.env.GDEVELOP_LIBGD_PATH,
  gdjsRoot: process.env.GDEVELOP_GDJS_ROOT,
  projectFile: process.env.GDEVELOP_TEST_PROJECT,
};
const missingConfiguration = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([name]) => name)
  .join(", ");

test(
  "exports and serves a real GDevelop project",
  { skip: missingConfiguration ? `Missing: ${missingConfiguration}` : false },
  async (t) => {
    const runtime = new GDevelopRuntime({
      libGDPath: config.libGDPath,
      gdjsRoot: config.gdjsRoot,
    });
    const app = createGDevelopMcpApp({ runtime });
    const client = new Client({
      name: "gdevelop-real-runtime-test",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      app.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    t.after(async () => {
      await client.close();
      await app.close();
    });

    const opened = await client.callTool({
      name: "open_project",
      arguments: { projectFile: config.projectFile },
    });
    assert.notEqual(opened.isError, true, opened.content?.[0]?.text);

    const built = await client.callTool({
      name: "build_preview",
      arguments: { projectId: opened.structuredContent.projectId },
    });
    assert.notEqual(built.isError, true, built.content?.[0]?.text);

    const response = await fetch(built.structuredContent.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<!DOCTYPE html>/i);

    await client.callTool({
      name: "stop_preview",
      arguments: { previewId: built.structuredContent.previewId },
    });
    await client.callTool({
      name: "close_project",
      arguments: { projectId: opened.structuredContent.projectId },
    });
  },
);
