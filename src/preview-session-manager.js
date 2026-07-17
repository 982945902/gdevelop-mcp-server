import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { startStaticPreviewServer } from "./static-preview-server.js";

export class PreviewSessionManager {
  constructor({
    runtime,
    projects,
    tempRoot = path.join(os.tmpdir(), "gdevelop-mcp"),
    serverFactory = startStaticPreviewServer,
  }) {
    this.runtime = runtime;
    this.projects = projects;
    this.tempRoot = path.resolve(tempRoot);
    this.serverFactory = serverFactory;
    this.previews = new Map();
    this.exportQueue = Promise.resolve();
  }

  describe(record) {
    const { server, buildPromise, ...description } = record;
    return description;
  }

  get(previewId) {
    const record = this.previews.get(previewId);
    if (!record) throw new Error(`Unknown preview session: ${previewId}`);
    return record;
  }

  list() {
    return Array.from(this.previews.values(), (record) =>
      this.describe(record),
    );
  }

  async build(projectId, options = {}) {
    const projectRecord = this.projects.get(projectId);
    await fs.mkdir(this.tempRoot, { recursive: true });
    const outputDirectory = await fs.mkdtemp(
      path.join(this.tempRoot, "preview-"),
    );
    const previewId = randomUUID();
    const record = {
      previewId,
      projectId,
      status: "building",
      sceneName: options.sceneName || null,
      outputDirectory,
      url: null,
      error: null,
      startedAt: new Date().toISOString(),
      readyAt: null,
      server: null,
      buildPromise: null,
    };
    this.previews.set(previewId, record);

    const build = async () => {
      try {
        const buildResult = await this.runtime.buildPreview(
          projectRecord.project,
          outputDirectory,
          options,
        );
        record.sceneName = buildResult.sceneName;
        record.server = await this.serverFactory({
          rootDirectory: outputDirectory,
        });
        record.url = record.server.url;
        record.status = "ready";
        record.readyAt = new Date().toISOString();
        return this.describe(record);
      } catch (error) {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };

    const queuedBuild = this.exportQueue.then(build, build);
    record.buildPromise = queuedBuild;
    this.exportQueue = queuedBuild.catch(() => {});
    return queuedBuild;
  }

  async stop(previewId) {
    const record = this.get(previewId);
    if (record.status === "building" && record.buildPromise) {
      await record.buildPromise.catch(() => {});
    }
    if (record.server) await record.server.close();
    await this.#removeOutputDirectory(record.outputDirectory);
    record.server = null;
    record.status = "stopped";
    record.url = null;
    record.stoppedAt = new Date().toISOString();
    return this.describe(record);
  }

  async stopForProject(projectId) {
    const records = Array.from(this.previews.values()).filter(
      (record) => projectId === record.projectId && record.status !== "stopped",
    );
    return Promise.all(records.map((record) => this.stop(record.previewId)));
  }

  async closeAll() {
    const active = Array.from(this.previews.values()).filter(
      (record) => record.status !== "stopped",
    );
    await Promise.allSettled(
      active.map((record) => this.stop(record.previewId)),
    );
  }

  async #removeOutputDirectory(outputDirectory) {
    const resolvedOutput = path.resolve(outputDirectory);
    if (!resolvedOutput.startsWith(`${this.tempRoot}${path.sep}`)) {
      throw new Error(
        `Refusing to remove preview outside temp root: ${resolvedOutput}`,
      );
    }
    await fs.rm(resolvedOutput, { recursive: true, force: true });
  }
}
