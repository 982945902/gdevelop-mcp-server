import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GDevelopRuntime } from "../src/gdevelop-runtime.js";

const libGDPath = process.env.GDEVELOP_LIBGD_PATH;
const gdjsRoot = process.env.GDEVELOP_GDJS_ROOT;

test(
  "authors structured variables, groups, instances, and native event sections",
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
    await runtime.setGlobalVariable(project, {
      name: "MetaProgress",
      value: { Echoes: 12, Unlocks: ["Fang", "Rift"] },
    });
    await runtime.setSceneVariable(project, {
      sceneName: "Game",
      name: "Run",
      value: { Risk: 0, Rooms: [1, 3, 2] },
    });
    await runtime.addSceneObject(project, {
      sceneName: "Game",
      name: "Player",
      type: "Sprite",
      resourceName: "player.svg",
      variables: {
        Health: 100,
        Build: { Weapon: "Claws", Runes: ["Frost", "Chain"] },
      },
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
      variables: { Spawn: { Room: 1, Elite: true } },
    });
    await runtime.addObjectInstance(project, {
      sceneName: "Game",
      objectName: "Hud",
      x: 24,
      y: 24,
      layer: "HUD",
    });
    await runtime.addObjectGroup(project, {
      sceneName: "Game",
      name: "Actors",
      objectNames: ["Player"],
    });
    await runtime.setSceneEvents(project, {
      sceneName: "Game",
      events: [
        {
          kind: "group",
          name: "Run bootstrap",
          folded: true,
          color: { r: 42, g: 32, b: 86 },
          events: [
            { kind: "comment", text: "Native event sheet authored through MCP" },
            {
              kind: "standard",
              conditions: [{ type: "BuiltinCommonInstructions::Once", parameters: [] }],
              actions: [{ type: "ModVarScene", parameters: ["Run.Risk", "=", "1"] }],
              subEvents: [],
            },
          ],
        },
      ],
    });
    await runtime.saveProject(project);

    const serialized = JSON.parse(await fs.readFile(projectFile, "utf8"));
    assert.equal(serialized.layouts[0].objects.find((object) => object.name === "Player").type, "Sprite");
    assert.equal(serialized.layouts[0].instances.length, 2);
    assert.equal(serialized.layouts[0].events.length, 1);
    assert.equal(serialized.layouts[0].events[0].type, "BuiltinCommonInstructions::Group");
    assert.equal(serialized.layouts[0].events[0].events.length, 2);
    const hud = serialized.layouts[0].objects.find((object) => object.name === "Hud");
    assert.equal(hud.bold, true);
    assert.equal(hud.textAlignment, "center");
    assert.equal(hud.content.isOutlineEnabled, true);
    assert.equal(hud.content.outlineThickness, 3);
    assert.equal(hud.content.isShadowEnabled, true);
    assert.ok(serialized.layouts[0].events.every((event) => event.type !== "BuiltinCommonInstructions::JsCode"));

    ({ project: reopened } = await runtime.openProject(projectFile));
    assert.equal(reopened.getVariables().get("MetaProgress").getChild("Echoes").getValue(), 12);
    assert.equal(
      reopened.getLayout("Game").getVariables().get("Run").getChild("Rooms").getAtIndex(1).getValue(),
      3,
    );
    const playerObject = reopened.getLayout("Game").getObjects().getObject("Player");
    assert.equal(
      playerObject.getVariables().get("Build").getChild("Weapon").getString(),
      "Claws",
    );
    const spawnVariable = serialized.layouts[0].instances[0].initialVariables.find(
      (variable) => variable.name === "Spawn",
    );
    assert.equal(
      spawnVariable.children.find((variable) => variable.name === "Elite").value,
      true,
    );
    const description = runtime.describeNativeProject(reopened);
    assert.equal(description.globalVariables, 1);
    assert.equal(description.scenes[0].events, 1);
    assert.equal(description.scenes[0].instances, 2);
    assert.equal(description.scenes[0].objects.length, 2);
    assert.deepEqual(description.scenes[0].objectGroups, [
      { name: "Actors", objects: ["Player"] },
    ]);
    await runtime.buildPreview(reopened, previewDirectory, { sceneName: "Game" });
    assert.match(
      await fs.readFile(path.join(previewDirectory, "code0.js"), "utf8"),
      /setNumber\(1\)/,
    );
  },
);
