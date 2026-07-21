import { randomUUID } from "node:crypto";
import path from "node:path";

export class ProjectSessionManager {
  constructor({ runtime }) {
    this.runtime = runtime;
    this.projects = new Map();
  }

  async open(projectFile) {
    const { project, summary } = await this.runtime.openProject(projectFile);
    const projectId = randomUUID();
    const record = {
      projectId,
      project,
      ...summary,
      openedAt: new Date().toISOString(),
    };
    this.projects.set(projectId, record);
    return this.describe(record);
  }

  async create(projectFile, options) {
    const { project, summary } = await this.runtime.createProject(
      projectFile,
      options,
    );
    const projectId = randomUUID();
    const record = {
      projectId,
      project,
      ...summary,
      openedAt: new Date().toISOString(),
    };
    this.projects.set(projectId, record);
    return this.describe(record);
  }

  async save(projectId) {
    const record = this.get(projectId);
    const summary = await this.runtime.saveProject(record.project);
    Object.assign(record, summary);
    return this.describe(record);
  }

  async importResource(projectId, input) {
    const record = this.get(projectId);
    const resource = await this.runtime.importResource(record.project, input);
    return { projectId, resource };
  }

  update(projectId, changes) {
    const record = this.get(projectId);
    const summary = this.runtime.updateProject(record.project, changes);
    Object.assign(record, summary);
    return this.describe(record);
  }

  async setSceneJavascript(projectId, input) {
    const record = this.get(projectId);
    const event = await this.runtime.setSceneJavascript(record.project, input);
    return { projectId, ...event };
  }

  async addSceneLayer(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.addSceneLayer(record.project, input)) };
  }

  async setSceneVariable(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.setSceneVariable(record.project, input)) };
  }

  async setGlobalVariable(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.setGlobalVariable(record.project, input)) };
  }

  async addObjectGroup(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.addObjectGroup(record.project, input)) };
  }

  async addSceneObject(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.addSceneObject(record.project, input)) };
  }

  async addObjectInstance(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.addObjectInstance(record.project, input)) };
  }

  async setSceneEvents(projectId, input) {
    const record = this.get(projectId);
    return { projectId, ...(await this.runtime.setSceneEvents(record.project, input)) };
  }

  async exportProject(projectId, { outputDirectory, sceneName }) {
    const record = this.get(projectId);
    const resolvedOutputDirectory = path.resolve(outputDirectory);
    await this.runtime.buildPreview(record.project, resolvedOutputDirectory, { sceneName });
    return { projectId, outputDirectory: resolvedOutputDirectory, sceneName: sceneName || record.scenes[0] };
  }

  describeNative(projectId) {
    const record = this.get(projectId);
    return { projectId, ...this.runtime.describeNativeProject(record.project) };
  }

  get(projectId) {
    const record = this.projects.get(projectId);
    if (!record) throw new Error(`Unknown project session: ${projectId}`);
    return record;
  }

  describe(record) {
    const { project, ...description } = record;
    return description;
  }

  list() {
    return Array.from(this.projects.values(), (record) =>
      this.describe(record),
    );
  }

  close(projectId) {
    const record = this.get(projectId);
    this.runtime.closeProject(record.project);
    this.projects.delete(projectId);
    return this.describe(record);
  }

  closeAll() {
    for (const projectId of Array.from(this.projects.keys())) {
      this.close(projectId);
    }
  }
}
