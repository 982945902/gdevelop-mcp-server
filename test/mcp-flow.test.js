import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createGDevelopMcpApp } from "../src/app.js";

class FakeRuntime {
  async openProject(projectFile) {
    return {
      project: { projectFile },
      summary: {
        projectFile,
        name: "MCP test game",
        scenes: ["Scene"],
        resolution: { width: 800, height: 600 },
      },
    };
  }

  async buildPreview(project, outputDirectory, { sceneName }) {
    await fs.writeFile(
      path.join(outputDirectory, "index.html"),
      `<h1>${project.projectFile}:${sceneName || "Scene"}</h1>`,
    );
    return { sceneName: sceneName || "Scene" };
  }

  closeProject(project) {
    project.closed = true;
  }
}

test("MCP tools complete the preview lifecycle and expose a fetchable URL", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "gdevelop-mcp-test-"),
  );
  const app = createGDevelopMcpApp({ runtime: new FakeRuntime(), tempRoot });
  const client = new Client({ name: "gdevelop-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    app.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  t.after(async () => {
    await client.close();
    await app.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const listedTools = await client.listTools();
  assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), [
    "build_preview",
    "close_project",
    "get_preview_status",
    "open_project",
    "stop_preview",
  ]);

  const opened = await client.callTool({
    name: "open_project",
    arguments: { projectFile: "/tmp/game.json" },
  });
  assert.equal(opened.isError, undefined);
  assert.equal(opened.structuredContent.name, "MCP test game");
  const { projectId } = opened.structuredContent;

  const built = await client.callTool({
    name: "build_preview",
    arguments: { projectId, sceneName: "Scene" },
  });
  assert.equal(built.isError, undefined);
  const { previewId, url, outputDirectory } = built.structuredContent;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /MCP test game|\/tmp\/game\.json:Scene/);

  const status = await client.callTool({
    name: "get_preview_status",
    arguments: { previewId },
  });
  assert.equal(status.structuredContent.status, "ready");

  const stopped = await client.callTool({
    name: "stop_preview",
    arguments: { previewId },
  });
  assert.equal(stopped.structuredContent.status, "stopped");
  await assert.rejects(fs.access(outputDirectory));

  const closed = await client.callTool({
    name: "close_project",
    arguments: { projectId },
  });
  assert.equal(closed.isError, undefined);
  assert.equal(app.projects.list().length, 0);
});

test("invalid session IDs are returned as MCP tool errors", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "gdevelop-mcp-test-"),
  );
  const app = createGDevelopMcpApp({ runtime: new FakeRuntime(), tempRoot });
  const client = new Client({ name: "gdevelop-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    app.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  t.after(async () => {
    await client.close();
    await app.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const result = await client.callTool({
    name: "build_preview",
    arguments: { projectId: "00000000-0000-4000-8000-000000000000" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown project session/);
});
