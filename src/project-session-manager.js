import { randomUUID } from "node:crypto";

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
