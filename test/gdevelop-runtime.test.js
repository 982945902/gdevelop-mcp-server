import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GDevelopRuntime } from "../src/gdevelop-runtime.js";

const makeFakeGd = () => {
  const state = {
    initialized: false,
    optionsDeleted: false,
    exporterDeleted: false,
    fileSystemDeleted: false,
  };

  class FakeProject {
    unserializeFrom(element) {
      this.data = element.data;
    }
    setProjectFile(projectFile) {
      this.projectFile = projectFile;
    }
    getName() {
      return this.data.name;
    }
    getLayoutsCount() {
      return this.data.layouts.length;
    }
    getLayoutAt(index) {
      return { getName: () => this.data.layouts[index].name };
    }
    getGameResolutionWidth() {
      return 800;
    }
    getGameResolutionHeight() {
      return 600;
    }
    delete() {
      this.deleted = true;
    }
  }

  class FakeFileSystem {
    delete() {
      state.fileSystemDeleted = true;
    }
  }

  class FakePreviewOptions {
    constructor(project, outputDirectory) {
      this.project = project;
      this.outputDirectory = outputDirectory;
    }
    setLayoutName(value) {
      this.sceneName = value;
    }
    setShouldClearExportFolder() {}
    setShouldReloadProjectData() {}
    setShouldReloadLibraries() {}
    setShouldGenerateScenesEventsCode() {}
    setFullLoadingScreen() {}
    setIsDevelopmentEnvironment() {}
    useMinimalDebuggerClient() {}
    delete() {
      state.optionsDeleted = true;
    }
  }

  class FakeExporter {
    constructor(fileSystem) {
      this.fileSystem = fileSystem;
    }
    exportProjectForPixiPreview(options) {
      this.fileSystem.clearDir(options.outputDirectory);
      this.fileSystem.writeToFile(
        path.join(options.outputDirectory, "index.html"),
        `<h1>${options.project.getName()}:${options.sceneName}</h1>`,
      );
      return true;
    }
    getLastError() {
      return "";
    }
    delete() {
      state.exporterDeleted = true;
    }
  }

  return {
    state,
    gd: {
      initializePlatforms() {
        state.initialized = true;
      },
      ProjectHelper: { createNewGDJSProject: () => new FakeProject() },
      Serializer: {
        fromJSObject: (data) => ({
          data,
          delete() {
            state.serializerDeleted = true;
          },
        }),
      },
      AbstractFileSystemJS: FakeFileSystem,
      VectorString: class {
        values = [];
        push_back(value) {
          this.values.push(value);
        }
      },
      PreviewExportOptions: FakePreviewOptions,
      Exporter: FakeExporter,
    },
  };
};

test("loads a project and exports a preview through the libGD adapter", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "gdevelop-runtime-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectFile = path.join(root, "game.json");
  const outputDirectory = path.join(root, "preview");
  await fs.writeFile(
    projectFile,
    JSON.stringify({ name: "Test game", layouts: [{ name: "Scene" }] }),
  );

  const { gd, state } = makeFakeGd();
  const fakeLibGDPath = path.join(root, "libGD.js");
  const fakeGDJSRoot = path.join(root, "GDJS");
  await fs.writeFile(fakeLibGDPath, "fake");
  await fs.mkdir(path.join(fakeGDJSRoot, "Runtime"), { recursive: true });
  const runtime = new GDevelopRuntime({
    libGDPath: fakeLibGDPath,
    gdjsRoot: fakeGDJSRoot,
    loadExtensions: false,
    loadModule: () => async () => gd,
  });

  const opened = await runtime.openProject(projectFile);
  assert.equal(state.initialized, true);
  assert.equal(state.serializerDeleted, true);
  assert.deepEqual(opened.summary.scenes, ["Scene"]);

  const build = await runtime.buildPreview(opened.project, outputDirectory, {});
  assert.equal(build.sceneName, "Scene");
  assert.equal(
    await fs.readFile(path.join(outputDirectory, "index.html"), "utf8"),
    "<h1>Test game:Scene</h1>",
  );
  assert.equal(state.optionsDeleted, true);
  assert.equal(state.exporterDeleted, true);
  assert.equal(state.fileSystemDeleted, true);

  runtime.closeProject(opened.project);
  assert.equal(opened.project.deleted, true);
});
