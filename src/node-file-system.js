import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isUrl = (value) => /^https?:\/\//i.test(value);

/**
 * Create the JavaScript implementation expected by gd.AbstractFileSystemJS.
 * Paths exposed to GDevelop always use forward slashes, including on Windows.
 */
export const createNodeFileSystem = ({ gd, tempDirectory }) => {
  const normalize = (value) => path.normalize(value).replace(/\\/g, "/");
  const implementation = {
    mkDir(directory) {
      if (isUrl(directory)) return true;
      fs.mkdirSync(directory, { recursive: true });
      return true;
    },
    dirExists(directory) {
      if (isUrl(directory)) return true;
      try {
        return fs.statSync(directory).isDirectory();
      } catch {
        return false;
      }
    },
    clearDir(directory) {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory, { recursive: true });
      return true;
    },
    getTempDir() {
      return tempDirectory || os.tmpdir();
    },
    fileNameFrom(fullPath) {
      return isUrl(fullPath) ? fullPath : path.basename(fullPath);
    },
    dirNameFrom(fullPath) {
      return isUrl(fullPath) ? fullPath : normalize(path.dirname(fullPath));
    },
    makeAbsolute(filename, baseDirectory) {
      if (isUrl(filename)) return filename;
      if (isUrl(baseDirectory)) return `${baseDirectory}/${filename}`;
      return normalize(path.resolve(baseDirectory, filename));
    },
    makeRelative(filename, baseDirectory) {
      if (isUrl(filename)) return filename;
      return normalize(path.relative(baseDirectory, filename));
    },
    isAbsolute(fullPath) {
      return (
        isUrl(fullPath) || fullPath.length === 0 || path.isAbsolute(fullPath)
      );
    },
    copyFile(source, destination) {
      // Preview exports can reference remote resources directly.
      if (isUrl(source)) return true;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (path.resolve(source) !== path.resolve(destination)) {
        fs.copyFileSync(source, destination);
      }
      return true;
    },
    writeToFile(filename, contents) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
      return true;
    },
    readFile(filename) {
      return fs.readFileSync(filename, "utf8");
    },
    readDir(directory, extension = "") {
      const output = new gd.VectorString();
      if (!fs.existsSync(directory)) return output;
      const normalizedExtension = extension.toUpperCase();
      for (const filename of fs.readdirSync(directory)) {
        if (
          !normalizedExtension ||
          filename.toUpperCase().endsWith(normalizedExtension)
        ) {
          output.push_back(normalize(path.join(directory, filename)));
        }
      }
      return output;
    },
    fileExists(filename) {
      if (isUrl(filename)) return true;
      try {
        return fs.statSync(filename).isFile();
      } catch {
        return false;
      }
    },
  };

  return {
    handle: Object.assign(new gd.AbstractFileSystemJS(), implementation),
    implementation,
  };
};
