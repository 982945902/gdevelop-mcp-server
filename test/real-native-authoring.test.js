import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GDevelopRuntime } from "../src/gdevelop-runtime.js";

const libGDPath = process.env.GDEVELOP_LIBGD_PATH;
const gdjsRoot = process.env.GDEVELOP_GDJS_ROOT;

test(
  "authors editable objects, behaviors, instances, variables, and standard events",
  { skip: !libGDPath || !gdjsRoot },
  async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "gdevelop-native-authoring-"));
    const projectFile = path.join(temp, "game.json");
    const resourceFile = path.join(temp, "player.svg");
    const previewDirectory = path.join(temp, "preview");
    await fs.writeFile(
      resourceFile,
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#7c3aed"/></svg>',
    );
    const runtime = new GDevelopRuntime({ libGDPath, gdjsRoot });
    let project;
    let reopened;
    t.after(async () => {
      if (reopened) runtime.closeProject(reopened);
      if (project) runtime.closeProject(project);
      await fs.rm(temp, { recursive: true, force: true });
    });

    ({ project } = await runtime.createProject(projectFile, {
      name: "Native MCP authored game",
      sceneName: "Game",
      renderingType: "2d",
      width: 960,
      height: 540,
    }));
    await runtime.importResource(project, {
      sourceFile: resourceFile,
      resourceName: "player.svg",
      kind: "image",
    });
    await runtime.addSceneLayer(project, { sceneName: "Game", layerName: "HUD" });
    await runtime.setSceneVariable(project, { sceneName: "Game", name: "Score", value: 0 });
    await runtime.addSceneObject(project, {
      sceneName: "Game",
      name: "Player",
      type: "Sprite",
      resourceName: "player.svg",
      variables: { Health: 100 },
      behaviors: [
        {
          name: "Platformer",
          type: "PlatformBehavior::PlatformerObjectBehavior",
          properties: {},
        },
      ],
    });
    await runtime.addSceneObject(project, {
      sceneName: "Game",
      name: "Hud",
      type: "TextObject::Text",
      text: "Score 0",
      characterSize: 32,
      textStyle: {
        bold: true,
        alignment: "center",
        outline: { enabled: true, thickness: 3, color: "12;8;30" },
        shadow: { enabled: true, opacity: 170, distance: 4, blurRadius: 2 },
      },
    });
    await runtime.addObjectInstance(project, {
      sceneName: "Game",
      objectName: "Player",
      x: 100,
      y: 100,
      width: 64,
      height: 64,
    });
    await runtime.addObjectInstance(project, {
      sceneName: "Game",
      objectName: "Hud",
      x: 24,
      y: 24,
      layer: "HUD",
    });
    await runtime.setSceneEvents(project, {
      sceneName: "Game",
      events: [
        { kind: "comment", text: "Native event sheet authored through MCP" },
        {
          kind: "standard",
          conditions: [{ type: "BuiltinCommonInstructions::Once", parameters: [] }],
          actions: [{ type: "ModVarScene", parameters: ["Score", "=", "1"] }],
          subEvents: [],
        },
      ],
    });
    await runtime.saveProject(project);

    const serialized = JSON.parse(await fs.readFile(projectFile, "utf8"));
    assert.equal(serialized.layouts[0].objects.find((object) => object.name === "Player").type, "Sprite");
    assert.equal(serialized.layouts[0].instances.length, 2);
    assert.equal(serialized.layouts[0].events.length, 2);
    const hud = serialized.layouts[0].objects.find((object) => object.name === "Hud");
    assert.equal(hud.bold, true);
    assert.equal(hud.textAlignment, "center");
    assert.equal(hud.content.isOutlineEnabled, true);
    assert.equal(hud.content.outlineThickness, 3);
    assert.equal(hud.content.isShadowEnabled, true);
    assert.ok(serialized.layouts[0].events.every((event) => event.type !== "BuiltinCommonInstructions::JsCode"));

    ({ project: reopened } = await runtime.openProject(projectFile));
    const description = runtime.describeNativeProject(reopened);
    assert.equal(description.scenes[0].events, 2);
    assert.equal(description.scenes[0].instances, 2);
    assert.equal(description.scenes[0].objects.length, 2);
    await runtime.buildPreview(reopened, previewDirectory, { sceneName: "Game" });
    assert.match(
      await fs.readFile(path.join(previewDirectory, "code0.js"), "utf8"),
      /setNumber\(1\)/,
    );
  },
);
