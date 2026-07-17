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

export const createMcpServer = ({ projects, previews }) => {
  const server = new McpServer({
    name: "gdevelop-local-runtime",
    version: "0.1.0",
  });

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
