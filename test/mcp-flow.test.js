import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createGDevelopMcpApp } from "../src/app.js";

class FakeRuntime {
  async createProject(projectFile, options) {
    this.lastCreateOptions = options;
    return {
      project: { projectFile, name: options.name, resources: [], scripts: [] },
      summary: {
        projectFile,
        name: options.name,
        scenes: [options.sceneName || "Game"],
        resolution: { width: options.width || 1280, height: options.height || 720 },
      },
    };
  }

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

  async importResource(project, input) {
    const resource = {
      name: input.resourceName,
      kind: input.kind === "auto" ? "image" : input.kind,
      file: input.sourceFile,
    };
    project.resources.push(resource);
    return resource;
  }

  updateProject(project, changes) {
    if (changes.name) project.name = changes.name;
    return {
      projectFile: project.projectFile,
      name: project.name,
      scenes: ["Scene"],
      resolution: { width: changes.width || 800, height: changes.height || 600 },
    };
  }

  async setSceneJavascript(project, input) {
    project.scripts ||= [];
    project.scripts.push(input);
    return { sceneName: input.sceneName, mode: input.mode, eventCount: project.scripts.length };
  }

  async setGlobalVariable(project, input) {
    project.globalVariables ||= {};
    project.globalVariables[input.name] = input.value;
    return input;
  }

  async setSceneVariable(project, input) {
    project.sceneVariables ||= {};
    project.sceneVariables[input.name] = input.value;
    return input;
  }

  async setSceneEvents(project, input) {
    project.nativeEvents = input.events;
    return {
      sceneName: input.sceneName,
      mode: input.mode,
      eventCount: input.events.length,
    };
  }

  async addObjectGroup(project, input) {
    project.objectGroups ||= [];
    project.objectGroups.push(input);
    return input;
  }

  async saveProject(project) {
    project.saved = true;
    return {
      projectFile: project.projectFile,
      name: project.name || "MCP test game",
      scenes: ["Scene"],
      resolution: { width: 800, height: 600 },
    };
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
    "add_object_group",
    "add_object_instance",
    "add_scene_layer",
    "add_scene_object",
    "build_preview",
    "close_project",
    "create_project",
    "describe_native_project",
    "export_project",
    "get_preview_status",
    "import_resource",
    "open_project",
    "save_project",
    "set_global_variable",
    "set_scene_events",
    "set_scene_javascript",
    "set_scene_variable",
    "stop_preview",
    "update_project",
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

test("MCP can create, mutate, resource-link, script, and save a project", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gdevelop-mcp-authoring-"));
  const runtime = new FakeRuntime();
  const app = createGDevelopMcpApp({ runtime, tempRoot });
  const client = new Client({ name: "gdevelop-mcp-authoring-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await app.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const created = await client.callTool({
    name: "create_project",
    arguments: {
      projectFile: path.join(tempRoot, "game.json"),
      name: "Authoring game",
      sceneName: "Game",
      renderingType: "3d",
      adaptGameResolutionAtRuntime: false,
      sizeOnStartupMode: "",
      loadingBackgroundResourceName: "loading.png",
      loadingBackgroundColor: 526113,
      loadingMinDuration: 0.35,
      showGDevelopSplash: false,
    },
  });
  const { projectId } = created.structuredContent;
  assert.equal(created.structuredContent.name, "Authoring game");
  assert.equal(runtime.lastCreateOptions.adaptGameResolutionAtRuntime, false);
  assert.equal(runtime.lastCreateOptions.sizeOnStartupMode, "");
  assert.equal(runtime.lastCreateOptions.loadingBackgroundResourceName, "loading.png");
  assert.equal(runtime.lastCreateOptions.loadingBackgroundColor, 526113);
  assert.equal(runtime.lastCreateOptions.loadingMinDuration, 0.35);
  assert.equal(runtime.lastCreateOptions.showGDevelopSplash, false);

  const updated = await client.callTool({
    name: "update_project",
    arguments: { projectId, name: "Updated game", width: 1920, height: 1080 },
  });
  assert.equal(updated.structuredContent.name, "Updated game");

  const imported = await client.callTool({
    name: "import_resource",
    arguments: {
      projectId,
      sourceFile: path.join(tempRoot, "cat.png"),
      resourceName: "cat.png",
      kind: "image",
    },
  });
  assert.equal(imported.structuredContent.resource.name, "cat.png");

  const scripted = await client.callTool({
    name: "set_scene_javascript",
    arguments: { projectId, sceneName: "Game", code: "console.log('hello')" },
  });
  assert.equal(scripted.structuredContent.eventCount, 1);

  const globalVariable = await client.callTool({
    name: "set_global_variable",
    arguments: {
      projectId,
      name: "MetaProgress",
      value: { Echoes: 12, Unlocks: ["Fang", "Rift"] },
    },
  });
  assert.equal(globalVariable.structuredContent.value.Unlocks[1], "Rift");

  const sceneVariable = await client.callTool({
    name: "set_scene_variable",
    arguments: {
      projectId,
      sceneName: "Game",
      name: "Run",
      value: { Risk: 2, Route: [1, 3, 2] },
    },
  });
  assert.equal(sceneVariable.structuredContent.value.Route[0], 1);

  const nativeEvents = await client.callTool({
    name: "set_scene_events",
    arguments: {
      projectId,
      sceneName: "Game",
      events: [
        {
          kind: "group",
          name: "Run bootstrap",
          events: [
            {
              kind: "standard",
              conditions: [],
              actions: [{ type: "ModVarScene", parameters: ["Run.Risk", "=", "1"] }],
              subEvents: [],
            },
          ],
        },
      ],
    },
  });
  assert.equal(nativeEvents.structuredContent.eventCount, 1);

  const saved = await client.callTool({
    name: "save_project",
    arguments: { projectId },
  });
  assert.equal(saved.isError, undefined);
});
