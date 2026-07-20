import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GDevelopRuntime } from "../src/gdevelop-runtime.js";

const libGDPath = process.env.GDEVELOP_LIBGD_PATH;
const gdjsRoot = process.env.GDEVELOP_GDJS_ROOT;
const resourceFile = process.env.GDEVELOP_TEST_RESOURCE;

test(
  "creates, authors, saves, reopens, and exports a real GDevelop project",
  { skip: !libGDPath || !gdjsRoot || !resourceFile },
  async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "gdevelop-authoring-"));
    const projectFile = path.join(temp, "game.json");
    const previewDirectory = path.join(temp, "preview");
    const runtime = new GDevelopRuntime({ libGDPath, gdjsRoot });
    let project;
    let reopened;
    t.after(async () => {
      if (reopened) runtime.closeProject(reopened);
      if (project) runtime.closeProject(project);
      await fs.rm(temp, { recursive: true, force: true });
    });

    ({ project } = await runtime.createProject(projectFile, {
      name: "Real MCP authored game",
      sceneName: "Game",
      renderingType: "3d",
      width: 960,
      height: 540,
    }));
    runtime.updateProject(project, {
      description: "Created by the real MCP authoring regression test.",
      packageName: "com.example.gdevelopmcp",
      maximumFps: 60,
    });
    const resource = await runtime.importResource(project, {
      sourceFile: resourceFile,
      resourceName: "models/test.glb",
      kind: "model3D",
    });
    assert.equal(resource.kind, "model3D");
    await runtime.setSceneJavascript(project, {
      sceneName: "Game",
      code: "document.documentElement.dataset.mcpAuthored = 'true';",
    });
    await runtime.saveProject(project);

    const opened = await runtime.openProject(projectFile);
    reopened = opened.project;
    assert.equal(opened.summary.name, "Real MCP authored game");
    assert.deepEqual(opened.summary.resolution, { width: 960, height: 540 });
    await runtime.buildPreview(reopened, previewDirectory, { sceneName: "Game" });
    const html = await fs.readFile(path.join(previewDirectory, "index.html"), "utf8");
    assert.doesNotMatch(html, /<script[^>]+\.wasm/);
    assert.match(await fs.readFile(path.join(previewDirectory, "code0.js"), "utf8"), /mcpAuthored/);
  },
);
