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
