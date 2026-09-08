import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { serializeArtifact } from "./artifact.mjs";
import { normalizeSpec, outputSlug } from "./core.mjs";
import {
  extensionForFormat,
  hashSpec,
  inferFormat,
  normalizeFormat,
} from "./formats.mjs";

export const MANIFEST_VERSION = 2;

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function readJson(filePath) {
  const source = await readText(filePath);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeTextAtomic(filePath, source) {
  await writeArtifactsAtomic([{ path: filePath, source: String(source), overwrite: true }]);
}

export async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeArtifactsAtomic(records, options = {}) {
  const prepared = records.map((record) => ({
    ...record,
    path: path.resolve(record.path),
    source: record.source ?? serializeArtifact(record.format, record.content),
    canOverwrite: record.overwrite ?? options.overwrite ?? false,
  }));
  const paths = new Set();
  for (const record of prepared) {
    const key = process.platform === "win32" ? record.path.toLowerCase() : record.path;
    if (paths.has(key)) throw new Error(`Duplicate output path: ${record.path}`);
    paths.add(key);
    const existing = await fileType(record.path);
    if (existing && existing !== "file") throw new Error(`Output path is not a file: ${record.path}`);
    if (!record.canOverwrite && existing) {
      throw new Error(`Refusing to overwrite ${record.path}.`);
    }
    await verifyExpectedHash(record);
  }

  const staged = [];
  const committed = [];
  try {
    for (const record of prepared) {
      await fs.mkdir(path.dirname(record.path), { recursive: true });
      const temporary = temporaryPath(record.path);
      await fs.writeFile(temporary, record.source, "utf8");
      staged.push({ ...record, temporary });
    }

    for (const record of staged) {
      await verifyExpectedHash(record);
      if (!record.canOverwrite) {
        await fs.link(record.temporary, record.path);
        await fs.rm(record.temporary, { force: true });
        committed.push({ path: record.path, rollback: null });
        continue;
      }
      let rollback = null;
      if (await exists(record.path)) {
        rollback = rollbackPath(record.path);
        await fs.rename(record.path, rollback);
      }
      try {
        await fs.rename(record.temporary, record.path);
      } catch (error) {
        if (rollback) await fs.rename(rollback, record.path);
        throw error;
      }
      committed.push({ path: record.path, rollback });
    }
  } catch (error) {
    for (const record of committed.reverse()) {
      await fs.rm(record.path, { force: true });
      if (record.rollback && await exists(record.rollback)) await fs.rename(record.rollback, record.path);
    }
    throw error;
  } finally {
    await Promise.all(staged.map((record) => fs.rm(record.temporary, { force: true })));
  }
  await Promise.allSettled(committed.map((record) => record.rollback ? fs.rm(record.rollback, { force: true }) : null));
  return prepared;
}

export async function nextOutputPath(workspaceRoot, spec, requestedPath = null, format = "excalidraw") {
  const outputs = await nextOutputPaths(workspaceRoot, spec, [format], requestedPath);
  return outputs[0].path;
}

export async function nextOutputPaths(workspaceRoot, spec, formats, requestedPath = null, preferredStem = null) {
  const names = [...new Set(formats.map((format) => normalizeFormat(format)))];
  if (names.some((format) => !format)) throw new Error("Unsupported output format.");
  if (requestedPath) {
    if (names.length !== 1) throw new Error("An explicit output path requires exactly one format.");
    return [{ format: names[0], path: path.resolve(workspaceRoot, requestedPath) }];
  }

  const directory = path.join(workspaceRoot, "drawings");
  await fs.mkdir(directory, { recursive: true });
  const slug = preferredStem || outputSlug(spec);
  let counter = 1;
  while (true) {
    const stem = counter === 1 ? slug : `${slug}-${counter}`;
    const outputs = names.map((format) => ({
      format,
      path: path.join(directory, `${stem}${extensionForFormat(format)}`),
    }));
    if (!(await anyExists(outputs.map((output) => output.path)))) return outputs;
    counter += 1;
  }
}

export async function saveWorkspaceState(workspaceRoot, input, artifacts, options = {}) {
  const prepared = await prepareWorkspaceState(workspaceRoot, input, artifacts, options);
  if (prepared.manifestBackupNeeded) await backupSpec(prepared.manifestPath);
  await writeArtifactsAtomic(prepared.stateRecords);
  return workspaceStateResult(prepared);
}

export async function prepareWorkspaceState(workspaceRoot, input, artifacts, options = {}) {
  const spec = normalizeSpec(input);
  const stateRoot = path.join(workspaceRoot, ".drawing-master");
  const specsRoot = path.join(stateRoot, "specs");
  await fs.mkdir(specsRoot, { recursive: true });
  await ensureIgnoreFile(stateRoot);
  const specPath = path.join(specsRoot, `${safeName(spec.documentId)}.json`);
  const manifestPath = path.join(stateRoot, "manifest.json");
  const { manifest, migrated, sourceHash: manifestSourceHash } = await readWorkspaceManifest(workspaceRoot);
  const specDigest = hashSpec(spec);
  const records = await normalizeArtifactRecords(artifacts);
  const previous = manifest.documents[spec.documentId] ?? {};
  const nextArtifacts = { ...(previous.artifacts ?? {}) };
  for (const format of options.detachFormats ?? []) delete nextArtifacts[normalizeFormat(format)];

  for (const record of records) {
    const format = normalizeFormat(record.format ?? inferFormat(record.path));
    if (!format) throw new Error(`Cannot determine artifact format for ${record.path}.`);
    const source = record.source ?? await readText(record.path);
    nextArtifacts[format] = {
      format,
      path: relativePortable(workspaceRoot, record.path),
      artifactHash: hashSource(source),
      specHash: specDigest,
      formatVersion: record.formatVersion ?? formatVersion(format),
      compiledAt: new Date().toISOString(),
    };
  }
  for (const artifact of Object.values(nextArtifacts)) resolveWorkspacePath(workspaceRoot, artifact.path);

  const specSourceHash = await currentFileHash(specPath);

  manifest.documents[spec.documentId] = {
    documentId: spec.documentId,
    specPath: relativePortable(workspaceRoot, specPath),
    specHash: specDigest,
    schemaVersion: spec.schemaVersion,
    artifacts: nextArtifacts,
  };

  return {
    manifestPath,
    specPath,
    specHash: specDigest,
    manifestBackupNeeded: migrated && await exists(manifestPath),
    stateRecords: [
      { path: specPath, source: `${JSON.stringify(spec, null, 2)}\n`, overwrite: true, expectedHash: specSourceHash },
      { path: manifestPath, source: `${JSON.stringify(manifest, null, 2)}\n`, overwrite: true, expectedHash: manifestSourceHash },
    ],
  };
}

export async function readWorkspaceManifest(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, ".drawing-master", "manifest.json");
  if (!(await exists(manifestPath))) {
    return { manifest: emptyManifest(), migrated: false, manifestPath, sourceHash: null };
  }
  const source = await readText(manifestPath);
  let input;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${error.message}`);
  }
  if (Number(input.manifestVersion ?? 1) > MANIFEST_VERSION) {
    throw new Error(`Unsupported manifestVersion ${input.manifestVersion}.`);
  }
  if (Number(input.manifestVersion ?? 1) === MANIFEST_VERSION) {
    return { manifest: normalizeManifest(input), migrated: false, manifestPath, sourceHash: hashSource(source) };
  }
  const manifest = await migrateManifestV1(workspaceRoot, input);
  return { manifest, migrated: true, manifestPath, sourceHash: hashSource(source) };
}

export async function inspectWorkspaceDocument(workspaceRoot, documentId) {
  const { manifest, migrated, manifestPath } = await readWorkspaceManifest(workspaceRoot);
  const document = manifest.documents[documentId] ?? null;
  if (!document) return { manifest, manifestPath, migrated, document: null, artifacts: {} };
  const artifacts = {};
  for (const [format, artifact] of Object.entries(document.artifacts ?? {})) {
    const artifactPath = resolveWorkspacePath(workspaceRoot, artifact.path);
    let state;
    let currentHash = null;
    if (!(await exists(artifactPath))) state = "missing";
    else {
      currentHash = hashSource(await readText(artifactPath));
      if (!artifact.artifactHash || currentHash !== artifact.artifactHash) state = "modified";
      else if (artifact.specHash !== document.specHash) state = "stale";
      else state = "current";
    }
    artifacts[format] = { ...artifact, path: artifactPath, state, currentHash };
  }
  return { manifest, manifestPath, migrated, document, artifacts };
}

export async function detachWorkspaceArtifacts(workspaceRoot, documentId, formats) {
  const { manifest, manifestPath } = await readWorkspaceManifest(workspaceRoot);
  const document = manifest.documents[documentId];
  if (!document) throw new Error(`Document ${documentId} is not managed in this workspace.`);
  for (const format of formats) delete document.artifacts[normalizeFormat(format)];
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath };
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

  const format = inferFormat(sourcePath) ?? path.extname(sourcePath).toLowerCase();
  const entries = (await fs.readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && (inferFormat(entry.name) ?? path.extname(entry.name).toLowerCase()) === format)
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

async function migrateManifestV1(workspaceRoot, input) {
  const manifest = emptyManifest();
  for (const [documentId, document] of Object.entries(input.documents ?? {})) {
    const specPath = document.specPath ?? `.drawing-master/specs/${safeName(documentId)}.json`;
    const absoluteSpecPath = resolveWorkspacePath(workspaceRoot, specPath);
    let specDigest = null;
    try {
      specDigest = hashSpec(normalizeSpec(await readJson(absoluteSpecPath)));
    } catch {
      // A missing legacy spec remains visible and will be rejected by sync.
    }
    const artifactPath = document.path ? resolveWorkspacePath(workspaceRoot, document.path) : null;
    manifest.documents[documentId] = {
      documentId,
      specPath,
      specHash: specDigest,
      schemaVersion: document.schemaVersion ?? 1,
      artifacts: artifactPath ? {
        excalidraw: {
          format: "excalidraw",
          path: relativePortable(workspaceRoot, artifactPath),
          artifactHash: null,
          specHash: specDigest,
          formatVersion: 2,
          compiledAt: document.compiledAt ?? null,
        },
      } : {},
    };
  }
  return manifest;
}

function normalizeManifest(input) {
  const documents = Object.create(null);
  for (const [documentId, document] of Object.entries(input.documents ?? {})) {
    documents[documentId] = document;
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    documents,
  };
}

function emptyManifest() {
  return { manifestVersion: MANIFEST_VERSION, documents: Object.create(null) };
}

async function normalizeArtifactRecords(artifacts) {
  const values = Array.isArray(artifacts) ? artifacts : [artifacts];
  return Promise.all(values.filter(Boolean).map(async (artifact) => {
    if (typeof artifact === "string") {
      return { path: path.resolve(artifact), format: inferFormat(artifact), source: await readText(artifact) };
    }
    return {
      ...artifact,
      path: path.resolve(artifact.path),
      source: artifact.source ?? (artifact.content == null ? await readText(artifact.path) : serializeArtifact(artifact.format, artifact.content)),
    };
  }));
}

async function ensureIgnoreFile(stateRoot) {
  const ignorePath = path.join(stateRoot, ".gitignore");
  if (!(await exists(ignorePath))) {
    await fs.writeFile(ignorePath, "backups/\ntmp/\n*.tmp-*\n*.bak-*\n", "utf8");
  }
}

async function fileType(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function anyExists(paths) {
  const values = await Promise.all(paths.map(exists));
  return values.some(Boolean);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function temporaryPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function rollbackPath(filePath) {
  return `${filePath}.rollback-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashSource(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

async function currentFileHash(filePath) {
  return await exists(filePath) ? hashSource(await readText(filePath)) : null;
}

async function verifyExpectedHash(record) {
  if (!Object.hasOwn(record, "expectedHash")) return;
  const actualHash = await currentFileHash(record.path);
  if (actualHash === record.expectedHash) return;
  const error = new Error(`Output changed during commit: ${record.path}`);
  error.code = "artifact.concurrentModification";
  error.details = { path: record.path, expectedHash: record.expectedHash, actualHash };
  throw error;
}

function formatVersion(format) {
  return format === "excalidraw" ? 2 : 1;
}

function safeName(value) {
  const source = String(value);
  const prefix = source.replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "document";
  return `${prefix}-${crypto.createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
}

function relativePortable(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Managed path must stay inside the workspace: ${target}`);
  }
  return relative.split(path.sep).join("/");
}

function resolveWorkspacePath(root, portablePath) {
  if (typeof portablePath !== "string" || portablePath.length === 0 || path.isAbsolute(portablePath)) {
    throw new Error(`Managed path must be workspace-relative: ${String(portablePath)}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, portablePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Managed path escapes the workspace: ${portablePath}`);
  }
  return resolved;
}

function workspaceStateResult(prepared) {
  return {
    manifestPath: prepared.manifestPath,
    specPath: prepared.specPath,
    specHash: prepared.specHash,
  };
}
