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

const resourceKindFromFile = (file) => {
  const extension = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].includes(extension)) return "image";
  if ([".glb", ".gltf"].includes(extension)) return "model3D";
  if ([".mp3", ".ogg", ".wav", ".aac", ".m4a", ".flac"].includes(extension)) return "audio";
  if ([".mp4", ".webm"].includes(extension)) return "video";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(extension)) return "font";
  if ([".json", ".atlas"].includes(extension)) return "json";
  if ([".js", ".mjs"].includes(extension)) return "javascript";
  throw new Error(`Unable to infer a GDevelop resource kind from ${file}.`);
};

const makeResource = (gd, kind) => {
  const constructors = {
    image: gd.ImageResource,
    model3D: gd.Model3DResource,
    audio: gd.AudioResource,
    video: gd.VideoResource,
    font: gd.FontResource,
    json: gd.JsonResource,
    javascript: gd.JavaScriptResource,
  };
  const ResourceConstructor = constructors[kind];
  if (!ResourceConstructor) throw new Error(`Unsupported resource kind: ${kind}`);
  return new ResourceConstructor();
};

const setVariableValue = (variable, value) => {
  if (typeof value === "boolean") variable.setBool(value);
  else if (typeof value === "number") variable.setValue(value);
  else variable.setString(String(value));
};

const appendInstruction = (gd, instructions, definition) => {
  const instruction = new gd.Instruction();
  instruction.setType(definition.type);
  const parameters = definition.parameters || [];
  instruction.setParametersCount(parameters.length);
  parameters.forEach((parameter, index) => {
    instruction.setParameter(index, String(parameter));
  });
  instruction.setInverted(Boolean(definition.inverted));
  // InstructionsList::push_back keeps object-declaration instructions at the
  // end, which breaks the common "Create then configure" event pattern. Insert
  // explicitly at the current size to preserve the authored order exactly.
  instructions.insert(instruction, instructions.size());
};

const appendNativeEvents = (gd, project, eventsList, definitions) => {
  for (const definition of definitions) {
    if (definition.kind === "comment") {
      const baseEvent = eventsList.insertNewEvent(
        project,
        "BuiltinCommonInstructions::Comment",
        eventsList.getEventsCount(),
      );
      const commentEvent = gd.asCommentEvent(baseEvent);
      commentEvent.setComment(definition.text);
      if (definition.color) {
        commentEvent.setBackgroundColor(
          definition.color.r,
          definition.color.g,
          definition.color.b,
        );
      }
      continue;
    }

    const baseEvent = eventsList.insertNewEvent(
      project,
      "BuiltinCommonInstructions::Standard",
      eventsList.getEventsCount(),
    );
    const standardEvent = gd.asStandardEvent(baseEvent);
    for (const condition of definition.conditions || []) {
      appendInstruction(gd, standardEvent.getConditions(), condition);
    }
    for (const action of definition.actions || []) {
      appendInstruction(gd, standardEvent.getActions(), action);
    }
    if (definition.subEvents?.length) {
      appendNativeEvents(
        gd,
        project,
        standardEvent.getSubEvents(),
        definition.subEvents,
      );
    }
  }
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

  async createProject(projectFile, options = {}) {
    const absoluteProjectFile = path.resolve(projectFile);
    if (!options.overwrite) {
      try {
        await fs.access(absoluteProjectFile);
        throw new Error(`Project already exists: ${absoluteProjectFile}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    const gd = await this.initialize();
    const project = gd.ProjectHelper.createNewGDJSProject();
    let serialized;
    try {
      const sceneName = options.sceneName || "Game";
      project.setName(options.name || path.basename(absoluteProjectFile, path.extname(absoluteProjectFile)));
      project.setDescription(options.description || "");
      project.setGameResolutionSize(options.width || 1280, options.height || 720);
      project.setAdaptGameResolutionAtRuntime(true);
      project.setMaximumFPS(options.maximumFps || 60);
      project.setMinimumFPS(options.minimumFps || 20);
      project.setPlayableWithKeyboard(true);
      project.setPlayableWithMobile(true);
      project.setProjectFile(absoluteProjectFile);

      const layout = project.insertNewLayout(sceneName, 0);
      project.setFirstLayout(sceneName);
      layout.setWindowDefaultTitle(project.getName());
      if (options.renderingType === "3d") {
        layout.insertNewLayer("World3D", 0);
        const layer = layout.getLayer("World3D");
        layer.setRenderingType("3d");
        layer.setCameraType("perspective");
        layer.setCamera3DNearPlaneDistance(0.1);
        layer.setCamera3DFarPlaneDistance(1000);
      }

      await fs.mkdir(path.dirname(absoluteProjectFile), { recursive: true });
      serialized = new gd.SerializerElement();
      project.serializeTo(serialized);
      await fs.writeFile(absoluteProjectFile, gd.Serializer.toJSON(serialized));
      return {
        project,
        summary: summarizeProject(project, absoluteProjectFile),
      };
    } catch (error) {
      deleteIfPossible(project);
      throw error;
    } finally {
      deleteIfPossible(serialized);
    }
  }

  async saveProject(project) {
    const projectFile = project.getProjectFile();
    if (!projectFile) throw new Error("The project has no project file path.");
    const gd = await this.initialize();
    let serialized;
    try {
      serialized = new gd.SerializerElement();
      project.serializeTo(serialized);
      await fs.writeFile(projectFile, gd.Serializer.toJSON(serialized));
      return summarizeProject(project, projectFile);
    } finally {
      deleteIfPossible(serialized);
    }
  }

  async importResource(project, { sourceFile, resourceName, kind = "auto" }) {
    const absoluteSourceFile = path.resolve(sourceFile);
    await fs.access(absoluteSourceFile);
    const gd = await this.initialize();
    const resolvedKind = kind === "auto" ? resourceKindFromFile(absoluteSourceFile) : kind;
    const resources = project.getResourcesManager();
    if (resources.hasResource(resourceName)) {
      throw new Error(`A resource named ${resourceName} already exists.`);
    }

    const resource = makeResource(gd, resolvedKind);
    try {
      const projectDirectory = path.dirname(project.getProjectFile());
      resource.setName(resourceName);
      resource.setFile(path.relative(projectDirectory, absoluteSourceFile).split(path.sep).join("/"));
      resource.setUserAdded(true);
      if (!resources.addResource(resource)) {
        throw new Error(`Unable to import resource ${resourceName}.`);
      }
      return {
        name: resourceName,
        kind: resolvedKind,
        file: resource.getFile(),
      };
    } finally {
      deleteIfPossible(resource);
    }
  }

  updateProject(project, changes) {
    if (changes.name !== undefined) project.setName(changes.name);
    if (changes.description !== undefined) project.setDescription(changes.description);
    if (changes.author !== undefined) project.setAuthor(changes.author);
    if (changes.packageName !== undefined) project.setPackageName(changes.packageName);
    if (changes.width !== undefined || changes.height !== undefined) {
      project.setGameResolutionSize(
        changes.width ?? project.getGameResolutionWidth(),
        changes.height ?? project.getGameResolutionHeight(),
      );
    }
    if (changes.maximumFps !== undefined) project.setMaximumFPS(changes.maximumFps);
    if (changes.minimumFps !== undefined) project.setMinimumFPS(changes.minimumFps);
    return summarizeProject(project, project.getProjectFile());
  }

  async addSceneLayer(project, { sceneName, layerName }) {
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const layout = project.getLayout(sceneName);
    if (layout.hasLayerNamed(layerName)) throw new Error(`Layer already exists: ${layerName}`);
    layout.insertNewLayer(layerName, layout.getLayersCount());
    return { sceneName, layerName, layerCount: layout.getLayersCount() };
  }

  async setSceneVariable(project, { sceneName, name, value }) {
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const variables = project.getLayout(sceneName).getVariables();
    const variable = variables.has(name)
      ? variables.get(name)
      : variables.insertNew(name, variables.count());
    setVariableValue(variable, value);
    return { sceneName, name, value };
  }

  async addSceneObject(project, input) {
    const gd = await this.initialize();
    const {
      sceneName,
      name,
      type,
      resourceName,
      collisionMask,
      animationName = "Idle",
      frameDuration = 0.12,
      loop = true,
      text = "",
      characterSize = 32,
      color = "255;255;255",
      behaviors = [],
      variables = {},
    } = input;
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const layout = project.getLayout(sceneName);
    const objects = layout.getObjects();
    if (objects.hasObjectNamed(name)) throw new Error(`Object already exists: ${name}`);
    const object = objects.insertNewObject(project, type, name, objects.getObjectsCount());

    if (type === "Sprite") {
      if (!resourceName) throw new Error(`Sprite ${name} requires resourceName.`);
      if (!project.getResourcesManager().hasResource(resourceName)) {
        throw new Error(`Unknown resource: ${resourceName}`);
      }
      const configuration = gd.asSpriteConfiguration(object.getConfiguration());
      const animation = new gd.Animation();
      const sprite = new gd.Sprite();
      // AnimationList and Direction take ownership of these values. Deleting the
      // wrappers here corrupts the Wasm-owned project and only fails later when a
      // second Sprite is serialized.
      animation.setName(animationName);
      animation.setDirectionsCount(1);
      const direction = animation.getDirection(0);
      direction.setLoop(loop);
      direction.setTimeBetweenFrames(frameDuration);
      sprite.setImageName(resourceName);
      if (collisionMask) {
        const polygon = gd.Polygon2d.createRectangle(
          collisionMask.width,
          collisionMask.height,
        );
        // Polygon2d::CreateRectangle is centered on (0, 0), while sprite
        // collision masks use top-left image coordinates. Move the rectangle
        // into the image bounds so runtime hitboxes align with the artwork.
        polygon.move(collisionMask.width / 2, collisionMask.height / 2);
        const polygons = new gd.VectorPolygon2d();
        polygons.push_back(polygon);
        sprite.setCustomCollisionMask(polygons);
      }
      direction.addSprite(sprite);
      configuration.getAnimations().addAnimation(animation);
    } else if (type === "TextObject::Text") {
      const configuration = gd.asTextObjectConfiguration(object.getConfiguration());
      configuration.setText(text);
      configuration.setCharacterSize(characterSize);
      configuration.setColor(color);
    }

    for (const [variableName, value] of Object.entries(variables)) {
      const objectVariables = object.getVariables();
      const variable = objectVariables.has(variableName)
        ? objectVariables.get(variableName)
        : objectVariables.insertNew(variableName, objectVariables.count());
      setVariableValue(variable, value);
    }

    for (const behaviorDefinition of behaviors) {
      const behavior = object.addNewBehavior(
        project,
        behaviorDefinition.type,
        behaviorDefinition.name,
      );
      const availableProperties = behavior.getProperties();
      const propertyKeys = availableProperties.keys();
      const normalizedPropertyKeys = new Map();
      for (let index = 0; index < propertyKeys.size(); index += 1) {
        const propertyKey = propertyKeys.at(index);
        normalizedPropertyKeys.set(propertyKey.toLowerCase(), propertyKey);
      }
      for (const [propertyName, propertyValue] of Object.entries(
        behaviorDefinition.properties || {},
      )) {
        const resolvedPropertyName =
          normalizedPropertyKeys.get(propertyName.toLowerCase()) || propertyName;
        const serializedPropertyValue =
          typeof propertyValue === "boolean"
            ? propertyValue
              ? "1"
              : "0"
            : String(propertyValue);
        if (!behavior.updateProperty(resolvedPropertyName, serializedPropertyValue)) {
          throw new Error(
            `Unable to set ${behaviorDefinition.name}.${propertyName} on ${name}.`,
          );
        }
      }
    }
    layout.updateBehaviorsSharedData(project);
    return {
      sceneName,
      name,
      type,
      behaviors: behaviors.map(({ name: behaviorName, type: behaviorType }) => ({
        name: behaviorName,
        type: behaviorType,
      })),
    };
  }

  async addObjectInstance(project, input) {
    const {
      sceneName,
      objectName,
      x,
      y,
      layer = "",
      zOrder = 0,
      width,
      height,
    } = input;
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const layout = project.getLayout(sceneName);
    if (!layout.getObjects().hasObjectNamed(objectName)) {
      throw new Error(`Unknown object: ${objectName}`);
    }
    if (layer && !layout.hasLayerNamed(layer)) throw new Error(`Unknown layer: ${layer}`);
    const instance = layout.getInitialInstances().insertNewInitialInstance();
    instance.setObjectName(objectName);
    instance.setX(x);
    instance.setY(y);
    instance.setLayer(layer);
    instance.setZOrder(zOrder);
    if (width !== undefined || height !== undefined) {
      instance.setHasCustomSize(true);
      instance.setShouldKeepRatio(width === undefined || height === undefined);
      if (width !== undefined) instance.setCustomWidth(width);
      if (height !== undefined) instance.setCustomHeight(height);
    }
    return { sceneName, objectName, x, y, layer, zOrder, width, height };
  }

  async setSceneEvents(project, { sceneName, events: definitions, mode = "replace" }) {
    const gd = await this.initialize();
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const events = project.getLayout(sceneName).getEvents();
    if (mode === "replace") events.clear();
    appendNativeEvents(gd, project, events, definitions);
    return { sceneName, mode, eventCount: events.getEventsCount() };
  }

  describeNativeProject(project) {
    const scenes = [];
    for (let layoutIndex = 0; layoutIndex < project.getLayoutsCount(); layoutIndex += 1) {
      const layout = project.getLayoutAt(layoutIndex);
      const objects = [];
      for (let objectIndex = 0; objectIndex < layout.getObjects().getObjectsCount(); objectIndex += 1) {
        const object = layout.getObjects().getObjectAt(objectIndex);
        const behaviorNames = object.getAllBehaviorNames();
        const behaviors = [];
        for (let behaviorIndex = 0; behaviorIndex < behaviorNames.size(); behaviorIndex += 1) {
          const behaviorName = behaviorNames.at(behaviorIndex);
          const behavior = object.getBehavior(behaviorName);
          behaviors.push({ name: behaviorName, type: behavior.getTypeName() });
        }
        objects.push({ name: object.getName(), type: object.getType(), behaviors });
      }
      scenes.push({
        name: layout.getName(),
        objects,
        instances: layout.getInitialInstances().getInstancesCount(),
        events: layout.getEvents().getEventsCount(),
        variables: layout.getVariables().count(),
      });
    }
    return { ...summarizeProject(project, project.getProjectFile()), scenes };
  }

  async setSceneJavascript(project, { sceneName, code, mode = "replace" }) {
    const gd = await this.initialize();
    if (!project.hasLayoutNamed(sceneName)) throw new Error(`Unknown scene: ${sceneName}`);
    const events = project.getLayout(sceneName).getEvents();
    const marker = "/* gdevelop-mcp:scene-script */";
    let jsEvent = null;
    if (mode === "replace") {
      for (let index = 0; index < events.getEventsCount(); index += 1) {
        const event = events.getEventAt(index);
        if (event.getType() !== "BuiltinCommonInstructions::JsCode") continue;
        const candidate = gd.asJsCodeEvent(event);
        if (candidate.getInlineCode().includes(marker)) {
          jsEvent = candidate;
          break;
        }
      }
    }
    if (!jsEvent) {
      jsEvent = gd.asJsCodeEvent(
        events.insertNewEvent(
          project,
          "BuiltinCommonInstructions::JsCode",
          events.getEventsCount(),
        ),
      );
    }
    jsEvent.setInlineCode(`${marker}\n${code}`);
    jsEvent.setParameterObjects("");
    return { sceneName, mode, eventCount: events.getEventsCount() };
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
      // Some libGD/GDJS artifact combinations list the raw Draco binary as an
      // include file. It must be fetched by DRACOLoader, never parsed as JS.
      const indexFile = path.join(outputDirectory, "index.html");
      const html = await fs.readFile(indexFile, "utf8");
      const sanitizedHtml = html.replace(
        /^\s*<script[^>]+src=["'][^"']+\.wasm["'][^>]*><\/script>\s*$/gm,
        "",
      );
      if (sanitizedHtml !== html) await fs.writeFile(indexFile, sanitizedHtml);
      return { sceneName: resolvedSceneName };
    } finally {
      deleteIfPossible(options);
      deleteIfPossible(exporter);
      deleteIfPossible(fileSystem);
    }
  }
}
