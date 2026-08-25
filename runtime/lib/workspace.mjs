import fs from "node:fs/promises";
import path from "node:path";
import { outputSlug } from "./core.mjs";

const MANIFEST_VERSION = 1;

export async function readJson(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

export async function nextOutputPath(workspaceRoot, spec, requestedPath = null) {
  if (requestedPath) return path.resolve(workspaceRoot, requestedPath);
  const directory = path.join(workspaceRoot, "drawings");
  await fs.mkdir(directory, { recursive: true });
  const slug = outputSlug(spec);
  let candidate = path.join(directory, `${slug}.excalidraw`);
  let counter = 2;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${slug}-${counter}.excalidraw`);
    counter += 1;
  }
  return candidate;
}

export async function saveWorkspaceState(workspaceRoot, spec, outputPath) {
  const stateRoot = path.join(workspaceRoot, ".drawing-master");
  const specsRoot = path.join(stateRoot, "specs");
  await fs.mkdir(specsRoot, { recursive: true });
  await ensureIgnoreFile(stateRoot);
  const specPath = path.join(specsRoot, `${safeName(spec.documentId)}.json`);
  await writeJsonAtomic(specPath, spec);

  const manifestPath = path.join(stateRoot, "manifest.json");
  const manifest = await readManifest(manifestPath);
  manifest.documents[spec.documentId] = {
    documentId: spec.documentId,
    path: relativePortable(workspaceRoot, outputPath),
    specPath: relativePortable(workspaceRoot, specPath),
    schemaVersion: spec.schemaVersion,
    compiledAt: new Date().toISOString(),
  };
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, specPath };
}

export async function backupDocument(workspaceRoot, documentId, sourcePath, retention = 10) {
  const backupRoot = path.join(
    workspaceRoot,
    ".drawing-master",
    "backups",
    safeName(documentId),
  );
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const unique = process.hrtime.bigint().toString();
  const backupPath = path.join(backupRoot, `${stamp}-${unique}-${path.basename(sourcePath)}`);
  await fs.copyFile(sourcePath, backupPath);

  const entries = (await fs.readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.all(entries.slice(retention).map((name) => fs.unlink(path.join(backupRoot, name))));
  return backupPath;
}

export async function backupSpec(specPath) {
  const backupPath = `${specPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(specPath, backupPath);
  return backupPath;
}

async function readManifest(manifestPath) {
  if (!(await exists(manifestPath))) {
    return { manifestVersion: MANIFEST_VERSION, documents: {} };
  }
  const manifest = await readJson(manifestPath);
  if (manifest.manifestVersion > MANIFEST_VERSION) {
    throw new Error(`Unsupported manifestVersion ${manifest.manifestVersion}.`);
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    documents: manifest.documents && typeof manifest.documents === "object" ? manifest.documents : {},
  };
}

async function ensureIgnoreFile(stateRoot) {
  const ignorePath = path.join(stateRoot, ".gitignore");
  if (!(await exists(ignorePath))) {
    await fs.writeFile(ignorePath, "backups/\ntmp/\n*.tmp-*\n*.bak-*\n", "utf8");
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeName(value) {
  return String(value).replace(/[^\p{L}\p{N}_.-]+/gu, "-");
}

function relativePortable(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}
