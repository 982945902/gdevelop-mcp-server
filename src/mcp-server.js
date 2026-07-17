import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const toolResult = (data, message) => ({
  content: [{ type: "text", text: message || JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

const runTool = (handler) => async (input) => {
  try {
    return await handler(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
};

const instructionSchema = z.object({
  type: z.string().min(1),
  parameters: z.array(z.string()).default([]),
  inverted: z.boolean().default(false),
});

const nativeEventSchema = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("comment"),
      text: z.string(),
      color: z
        .object({
          r: z.number().int().min(0).max(255),
          g: z.number().int().min(0).max(255),
          b: z.number().int().min(0).max(255),
        })
        .optional(),
    }),
    z.object({
      kind: z.literal("standard"),
      conditions: z.array(instructionSchema).default([]),
      actions: z.array(instructionSchema).default([]),
      subEvents: z.array(nativeEventSchema).default([]),
    }),
  ]),
);

export const createMcpServer = ({ projects, previews }) => {
  const server = new McpServer({
    name: "gdevelop-local-runtime",
    version: "0.3.0",
  });

  server.registerTool(
    "create_project",
    {
      title: "Create a GDevelop project",
      description:
        "Create a new editable GDevelop project JSON file and keep it open as a session.",
      inputSchema: {
        projectFile: z.string().min(1),
        name: z.string().min(1),
        sceneName: z.string().min(1).default("Game"),
        renderingType: z.enum(["2d", "3d"]).default("2d"),
        width: z.number().int().min(320).max(7680).default(1280),
        height: z.number().int().min(200).max(4320).default(720),
        description: z.string().optional(),
        overwrite: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectFile, ...options }) => {
      const project = await projects.create(projectFile, options);
      return toolResult(
        project,
        `Created ${project.name} as ${project.projectId} at ${project.projectFile}.`,
      );
    }),
  );

  server.registerTool(
    "open_project",
    {
      title: "Open a GDevelop project",
      description:
        "Load a local .json GDevelop project into an isolated in-memory session.",
      inputSchema: {
        projectFile: z
          .string()
          .min(1)
          .describe(
            "Absolute or working-directory-relative project JSON path.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    runTool(async ({ projectFile }) => {
      const project = await projects.open(projectFile);
      return toolResult(
        project,
        `Opened ${project.name || project.projectFile} as ${project.projectId}.`,
      );
    }),
  );

  server.registerTool(
    "import_resource",
    {
      title: "Import a GDevelop resource",
      description:
        "Register an existing local image, model, audio, video, font, JSON, or JavaScript file in an open project.",
      inputSchema: {
        projectId: z.string().uuid(),
        sourceFile: z.string().min(1),
        resourceName: z.string().min(1),
        kind: z
          .enum(["auto", "image", "model3D", "audio", "video", "font", "json", "javascript"])
          .default("auto"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.importResource(projectId, input);
      return toolResult(result, `Imported ${result.resource.name}.`);
    }),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update GDevelop project settings",
      description:
        "Update editable project metadata, resolution, and frame-rate settings in memory.",
      inputSchema: {
        projectId: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        author: z.string().optional(),
        packageName: z.string().min(1).optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(200).max(4320).optional(),
        maximumFps: z.number().int().min(1).max(240).optional(),
        minimumFps: z.number().int().min(1).max(240).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(({ projectId, ...changes }) => {
      const project = projects.update(projectId, changes);
      return toolResult(project, `Updated ${project.name}.`);
    }),
  );

  server.registerTool(
    "set_scene_javascript",
    {
      title: "Set scene JavaScript",
      description:
        "Add or replace an MCP-managed inline JavaScript event on a GDevelop scene.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        code: z.string(),
        mode: z.enum(["replace", "append"]).default("replace"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.setSceneJavascript(projectId, input);
      return toolResult(result, `Updated JavaScript for scene ${result.sceneName}.`);
    }),
  );

  server.registerTool(
    "add_scene_layer",
    {
      title: "Add a GDevelop scene layer",
      description: "Add an editable 2D layer to a scene, for example a HUD layer.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        layerName: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.addSceneLayer(projectId, input);
      return toolResult(result, `Added layer ${result.layerName} to ${result.sceneName}.`);
    }),
  );

  server.registerTool(
    "set_scene_variable",
    {
      title: "Set a GDevelop scene variable",
      description: "Create or update an editable scene variable with a number, string, or boolean value.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        name: z.string().min(1),
        value: z.union([z.number(), z.string(), z.boolean()]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.setSceneVariable(projectId, input);
      return toolResult(result, `Set scene variable ${result.name}.`);
    }),
  );

  server.registerTool(
    "add_scene_object",
    {
      title: "Add a native GDevelop object",
      description: "Create an editable scene object with optional Sprite/Text configuration, object variables, and behaviors.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        resourceName: z.string().min(1).optional(),
        collisionMask: z
          .object({
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .optional(),
        animationName: z.string().default("Idle"),
        frameDuration: z.number().positive().default(0.12),
        loop: z.boolean().default(true),
        text: z.string().default(""),
        characterSize: z.number().positive().default(32),
        color: z.string().default("255;255;255"),
        variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
        behaviors: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.string().min(1),
              properties: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
            }),
          )
          .default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.addSceneObject(projectId, input);
      return toolResult(result, `Added ${result.type} object ${result.name}.`);
    }),
  );

  server.registerTool(
    "add_object_instance",
    {
      title: "Place a GDevelop object instance",
      description: "Place an editable initial instance of a scene object.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        objectName: z.string().min(1),
        x: z.number(),
        y: z.number(),
        layer: z.string().default(""),
        zOrder: z.number().default(0),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.addObjectInstance(projectId, input);
      return toolResult(result, `Placed ${result.objectName} at ${result.x}, ${result.y}.`);
    }),
  );

  server.registerTool(
    "set_scene_events",
    {
      title: "Set native GDevelop scene events",
      description: "Replace or append editable standard events made of native GDevelop conditions and actions.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1),
        mode: z.enum(["replace", "append"]).default("replace"),
        events: z.array(nativeEventSchema),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.setSceneEvents(projectId, input);
      return toolResult(result, `Authored ${result.eventCount} native events in ${result.sceneName}.`);
    }),
  );

  server.registerTool(
    "describe_native_project",
    {
      title: "Describe native GDevelop project",
      description: "Inspect scenes, editable objects, behaviors, instances, variables, and event counts.",
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    runTool(({ projectId }) => {
      const result = projects.describeNative(projectId);
      return toolResult(result);
    }),
  );

  server.registerTool(
    "export_project",
    {
      title: "Export a GDevelop web project",
      description: "Export a persistent GDJS web build to a caller-selected local directory.",
      inputSchema: {
        projectId: z.string().uuid(),
        outputDirectory: z.string().min(1),
        sceneName: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    runTool(async ({ projectId, ...input }) => {
      const result = await projects.exportProject(projectId, input);
      return toolResult(result, `Exported ${result.sceneName} to ${result.outputDirectory}.`);
    }),
  );

  server.registerTool(
    "save_project",
    {
      title: "Save a GDevelop project",
      description: "Serialize an open in-memory project back to its JSON file.",
      inputSchema: { projectId: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectId }) => {
      const project = await projects.save(projectId);
      return toolResult(project, `Saved ${project.name} to ${project.projectFile}.`);
    }),
  );

  server.registerTool(
    "build_preview",
    {
      title: "Build and serve a GDevelop preview",
      description:
        "Compile a project with gd.Exporter, start a loopback HTTP server, and return its preview URL.",
      inputSchema: {
        projectId: z.string().uuid(),
        sceneName: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectId, sceneName }) => {
      const preview = await previews.build(projectId, { sceneName });
      return toolResult(
        preview,
        `Preview ${preview.previewId} is ready at ${preview.url}`,
      );
    }),
  );

  server.registerTool(
    "get_preview_status",
    {
      title: "Get GDevelop preview status",
      description:
        "Return one preview session, or list all sessions when previewId is omitted.",
      inputSchema: { previewId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    runTool(async ({ previewId }) => {
      const data = previewId
        ? previews.describe(previews.get(previewId))
        : { previews: previews.list() };
      return toolResult(data);
    }),
  );

  server.registerTool(
    "stop_preview",
    {
      title: "Stop a GDevelop preview",
      description:
        "Stop the loopback HTTP server and remove only this preview's temporary directory.",
      inputSchema: { previewId: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    runTool(async ({ previewId }) => {
      const preview = await previews.stop(previewId);
      return toolResult(preview, `Stopped preview ${previewId}.`);
    }),
  );

  server.registerTool(
    "close_project",
    {
      title: "Close a GDevelop project session",
      description:
        "Stop previews for a project and release its C++/Wasm project handle.",
      inputSchema: { projectId: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    runTool(async ({ projectId }) => {
      await previews.stopForProject(projectId);
      const project = projects.close(projectId);
      return toolResult(project, `Closed project session ${projectId}.`);
    }),
  );

  return server;
};
