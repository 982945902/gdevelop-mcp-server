import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { createNodeFileSystem } from "./node-file-system.js";

const require = createRequire(import.meta.url);
const identity = (message) => message;

const deleteIfPossible = (value) => {
  if (value && typeof value.delete === "function") value.delete();
};

const summarizeProject = (project, projectFile) => {
  const scenes = [];
  for (let index = 0; index < project.getLayoutsCount(); index += 1) {
    scenes.push(project.getLayoutAt(index).getName());
  }
  return {
    projectFile,
    name: project.getName(),
    scenes,
    resolution: {
      width: project.getGameResolutionWidth(),
      height: project.getGameResolutionHeight(),
    },
  };
};

/**
 * Thin adapter over libGD.js. Keeping this class free of MCP concerns makes the
 * exporter usable by tests, CLIs and future HTTP transports.
 */
export class GDevelopRuntime {
  constructor({ libGDPath, gdjsRoot, loadExtensions = true, loadModule } = {}) {
    this.libGDPath = libGDPath;
    this.gdjsRoot = gdjsRoot;
    this.shouldLoadExtensions = loadExtensions;
    this.loadModule = loadModule || ((modulePath) => require(modulePath));
    this.initialization = null;
  }

  async initialize() {
    if (!this.initialization) {
      this.initialization = this.#initializeOnce().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async #initializeOnce() {
    if (!this.libGDPath) {
      throw new Error("GDEVELOP_LIBGD_PATH is required.");
    }
    if (!this.gdjsRoot) {
      throw new Error("GDEVELOP_GDJS_ROOT is required.");
    }

    try {
      await fs.access(path.resolve(this.libGDPath));
    } catch {
      throw new Error(
        `libGD.js was not found at ${path.resolve(this.libGDPath)}. ` +
          "Build GDevelop.js or run the IDE resource import, then set GDEVELOP_LIBGD_PATH.",
      );
    }
    try {
      await fs.access(path.join(path.resolve(this.gdjsRoot), "Runtime"));
    } catch {
      throw new Error(
        `A built GDJS Runtime was not found at ${path.resolve(this.gdjsRoot)}. ` +
          "Run the GDJS build or IDE resource import, then set GDEVELOP_GDJS_ROOT.",
      );
    }

    const initializerModule = this.loadModule(path.resolve(this.libGDPath));
    const initializeGDevelopJs = initializerModule.default || initializerModule;
    if (typeof initializeGDevelopJs !== "function") {
      throw new Error(
        `libGD module does not export an initializer: ${this.libGDPath}`,
      );
    }

    const gd = await initializeGDevelopJs();
    gd.initializePlatforms();
    if (this.shouldLoadExtensions) await this.#loadExtensions(gd);
    return gd;
  }

  async #loadExtensions(gd) {
    const extensionsRoot = path.join(
      path.resolve(this.gdjsRoot),
      "Runtime",
      "Extensions",
    );
    let entries;
    try {
      entries = await fs.readdir(extensionsRoot, { withFileTypes: true });
    } catch (error) {
      throw new Error(
        `Unable to read GDJS extensions at ${extensionsRoot}: ${error.message}`,
      );
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.includes("Example")) continue;
      const modulePath = path.join(
        extensionsRoot,
        entry.name,
        "JsExtension.js",
      );
      try {
        await fs.access(modulePath);
      } catch {
        continue;
      }

      const extensionModule = this.loadModule(modulePath);
      if (typeof extensionModule.createExtension !== "function") {
        throw new Error(`Invalid GDJS extension module: ${modulePath}`);
      }
      const extension = extensionModule.createExtension(identity, gd);
      if (!extension) {
        throw new Error(
          `GDJS extension returned no declaration: ${modulePath}`,
        );
      }
      try {
        if (typeof extensionModule.runExtensionSanityTests === "function") {
          const failures = extensionModule.runExtensionSanityTests(
            gd,
            extension,
          );
          if (Array.from(failures || []).some(Boolean)) {
            throw new Error(
              `GDJS extension sanity checks failed: ${modulePath}`,
            );
          }
        }
        gd.JsPlatform.get().addNewExtension(extension);
      } finally {
        deleteIfPossible(extension);
      }
    }
  }

  async openProject(projectFile) {
    const absoluteProjectFile = path.resolve(projectFile);
    const serializedProject = JSON.parse(
      await fs.readFile(absoluteProjectFile, "utf8"),
    );
    const gd = await this.initialize();
    const project = gd.ProjectHelper.createNewGDJSProject();
    let element;
    try {
      element = gd.Serializer.fromJSObject(serializedProject);
      project.unserializeFrom(element);
      project.setProjectFile(absoluteProjectFile);
      return {
        project,
        summary: summarizeProject(project, absoluteProjectFile),
      };
    } catch (error) {
      deleteIfPossible(project);
      throw error;
    } finally {
      deleteIfPossible(element);
    }
  }

  closeProject(project) {
    deleteIfPossible(project);
  }

  async buildPreview(project, outputDirectory, { sceneName } = {}) {
    const gd = await this.initialize();
    const resolvedSceneName =
      sceneName ||
      (project.getLayoutsCount() > 0 ? project.getLayoutAt(0).getName() : "");
    if (!resolvedSceneName) {
      throw new Error("The project has no scene to preview.");
    }

    const { handle: fileSystem } = createNodeFileSystem({
      gd,
      tempDirectory: outputDirectory,
    });
    const exporter = new gd.Exporter(fileSystem, path.resolve(this.gdjsRoot));
    const options = new gd.PreviewExportOptions(project, outputDirectory);
    try {
      options.setLayoutName(resolvedSceneName);
      options.setShouldClearExportFolder(true);
      options.setShouldReloadProjectData(true);
      options.setShouldReloadLibraries(true);
      options.setShouldGenerateScenesEventsCode(true);
      options.setFullLoadingScreen(false);
      options.setIsDevelopmentEnvironment(true);

      const succeeded = exporter.exportProjectForPixiPreview(options);
      if (!succeeded) {
        const detail = exporter.getLastError ? exporter.getLastError() : "";
        throw new Error(
          `GDevelop preview export failed${detail ? `: ${detail}` : "."}`,
        );
      }
      return { sceneName: resolvedSceneName };
    } finally {
      deleteIfPossible(options);
      deleteIfPossible(exporter);
      deleteIfPossible(fileSystem);
    }
  }
}
