#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  compileArtifact,
  parseArtifact,
  readArtifactMetadata,
  serializeArtifact,
  validateArtifact,
} from "./lib/artifact.mjs";
import { migrateSpec, normalizeSpec } from "./lib/core.mjs";
import {
  hashSpec,
  inferFormat,
  normalizeFormat,
  resolveFormat,
} from "./lib/formats.mjs";
import { recommendChartType } from "./lib/guide.mjs";
import {
  hasRepositoryEvidence,
  verifyRepositoryEvidence,
} from "./lib/repository-evidence.mjs";
import {
  backupDocument,
  backupSpec,
  inspectWorkspaceDocument,
  nextOutputPaths,
  prepareWorkspaceState,
  readJson,
  readText,
  saveWorkspaceState,
  writeArtifactsAtomic,
  writeJsonAtomic,
} from "./lib/workspace.mjs";

const [command, ...rawArgs] = process.argv.slice(2);

try {
  if (command === "compile") await compileCommand(rawArgs);
  else if (command === "sync") await syncCommand(rawArgs);
  else if (command === "update") await updateCommand(rawArgs);
  else if (command === "validate") await validateCommand(rawArgs);
  else if (command === "check") await checkCommand(rawArgs);
  else if (command === "guide") await guideCommand(rawArgs);
  else if (command === "recover") await recoverCommand(rawArgs);
  else if (command === "migrate") await migrateCommand(rawArgs);
  else usage(command ? `Unknown command: ${command}` : null);
} catch (error) {
  const result = {
    code: error.code ?? "runtime.error",
    message: error.message,
    ...(error.details == null ? {} : { details: error.details }),
  };
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
}

async function compileCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length < 1 || positional.length > 2) usage("compile requires <spec.json> [output]");
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const requestedOutput = positional[1] ?? null;
  const formats = resolveCompileFormats(options.formats, requestedOutput);
  if (requestedOutput && formats.length !== 1) {
    fail("format.multipleOutput", "An explicit output path requires exactly one format.");
  }
  if (requestedOutput) {
    try {
      resolveFormat({ format: formats[0], outputPath: requestedOutput, strict: true });
    } catch (error) {
      fail("format.extensionMismatch", error.message);
    }
  }

  let spec = normalizeSpec(await readJson(path.resolve(positional[0])));
  const qualityProfile = resolveQualityProfile(options.quality);
  const compiledByFormat = new Map();
  if (formats.includes("excalidraw")) {
    let compiled = compileArtifact(spec, "excalidraw", { qualityProfile });
    for (let pass = 0; pass < 2 && hasLayoutWarnings(compiled.quality); pass += 1) {
      spec = {
        ...spec,
        layout: {
          ...spec.layout,
          gapX: Number(spec.layout.gapX ?? 180) * 1.25,
          gapY: Number(spec.layout.gapY ?? 120) * 1.25,
        },
      };
      compiled = compileArtifact(spec, "excalidraw", { qualityProfile });
    }
    assertQuality(compiled.quality, "excalidraw");
    spec = compiled.spec;
    compiledByFormat.set("excalidraw", compiled);
  }
  for (const format of formats.filter((name) => name !== "excalidraw")) {
    const compiled = compileArtifact(spec, format, { qualityProfile });
    assertQuality(compiled.quality, format);
    compiledByFormat.set(format, compiled);
  }

  const managed = await inspectWorkspaceDocument(workspace, spec.documentId);
  const firstManagedPath = Object.values(managed.artifacts)[0]?.path ?? null;
  const preferredStem = firstManagedPath ? path.basename(firstManagedPath, path.extname(firstManagedPath)) : null;
  const outputs = await nextOutputPaths(workspace, spec, formats, requestedOutput, preferredStem);
  if (!options.overwrite) {
    const conflict = await firstExisting(outputs.map((output) => output.path));
    if (conflict) fail("artifact.exists", `Refusing to overwrite ${conflict}.`, { path: conflict });
  }
  if (options.overwrite) {
    for (const output of outputs) {
      if (await exists(output.path)) {
        output.expectedHash = digest(await readText(output.path));
        await backupDocument(workspace, spec.documentId, output.path);
      }
    }
  }
  const records = outputs.map((output) => recordFor(output, compiledByFormat.get(output.format)));
  const state = await commitWithState(workspace, spec, records, {
    artifactOverwrite: options.overwrite === true,
  });
  printResult(resultFor("compile", records, state));
}

async function syncCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 1) usage("sync requires <spec.json>");
  if (options.conflict && !["overwrite", "copy"].includes(options.conflict)) {
    fail("cli.optionValue", "--conflict must be overwrite or copy.");
  }
  if (options.missing && !["regenerate", "detach"].includes(options.missing)) {
    fail("cli.optionValue", "--missing must be regenerate or detach.");
  }
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const qualityProfile = resolveQualityProfile(options.quality);
  const spec = normalizeSpec(await readJson(path.resolve(positional[0])));
  const inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  if (!inspection.document) {
    fail("artifact.unmanaged", `Document ${spec.documentId} is not managed in this workspace.`);
  }

  const managedFormats = Object.keys(inspection.artifacts);
  const selectedFormats = options.formats.length > 0
    ? resolveCompileFormats(options.formats, null)
    : managedFormats;
  const unmanaged = selectedFormats.filter((format) => !managedFormats.includes(format));
  if (unmanaged.length > 0) {
    fail("artifact.unmanagedFormat", "Requested formats are not managed for this document.", { formats: unmanaged });
  }
  const selectedArtifacts = selectedFormats.map((format) => inspection.artifacts[format]);
  const missing = selectedArtifacts.filter((artifact) => artifact.state === "missing");
  const modified = selectedArtifacts.filter((artifact) => artifact.state === "modified");
  if (missing.length > 0 && !["regenerate", "detach"].includes(options.missing)) {
    fail("artifact.missing", "Managed artifacts are missing.", summarizeArtifacts(missing));
  }
  if (modified.length > 0 && !["overwrite", "copy"].includes(options.conflict)) {
    fail("artifact.modified", "Managed artifacts contain changes made after the last compile.", summarizeArtifacts(modified));
  }

  const detachFormats = options.missing === "detach" ? missing.map((artifact) => artifact.format) : [];
  const artifacts = selectedArtifacts.filter((artifact) => !detachFormats.includes(artifact.format));
  if (artifacts.length === 0 && detachFormats.length === 0) {
    fail("artifact.none", `Document ${spec.documentId} has no managed artifacts to synchronize.`);
  }

  const records = [];
  for (const artifact of artifacts) {
    let existingDocument;
    if (artifact.format === "excalidraw" && await exists(artifact.path)) {
      existingDocument = parseArtifact("excalidraw", await readText(artifact.path), artifact.path);
    }
    const compiled = compileArtifact(spec, artifact.format, { existingDocument, qualityProfile });
    assertQuality(compiled.quality, artifact.format);
    let outputPath = artifact.path;
    if (artifact.state === "modified" && options.conflict === "copy") {
      outputPath = (await nextOutputPaths(workspace, spec, [artifact.format]))[0].path;
    }
    records.push(recordFor({
      format: artifact.format,
      path: outputPath,
      ...(outputPath === artifact.path ? { expectedHash: artifact.currentHash } : {}),
    }, compiled));
  }

  const backupPaths = [];
  for (const record of records) {
    if (await exists(record.path)) {
      backupPaths.push(await backupDocument(workspace, spec.documentId, record.path));
    }
  }
  const state = await commitWithState(workspace, spec, records, {
    artifactOverwrite: true,
    detachFormats,
  });
  const nextSpecHash = hashSpec(spec);
  const staleFormats = managedFormats.filter((format) => !selectedFormats.includes(format)
    && inspection.artifacts[format].specHash !== nextSpecHash);
  printResult({
    ...resultFor("sync", records, state),
    backupPaths,
    detachedFormats: detachFormats,
    selectedFormats,
    staleFormats,
  });
}

async function updateCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 2) usage("update requires <existing.excalidraw> <spec.json>");
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const output = path.resolve(positional[0]);
  const qualityProfile = resolveQualityProfile(options.quality);
  if (inferFormat(output) !== "excalidraw") {
    fail("update.unsupportedFormat", "External in-place update is supported only for .excalidraw files.");
  }
  const existingSource = await readText(output);
  const existing = parseArtifact("excalidraw", existingSource, output);
  const input = await readJson(path.resolve(positional[1]));
  const compiled = compileArtifact(input, "excalidraw", { existingDocument: existing, qualityProfile });
  assertQuality(compiled.quality, "excalidraw");
  const backupPath = await backupDocument(workspace, compiled.spec.documentId, output);
  const record = recordFor({ format: "excalidraw", path: output, expectedHash: digest(existingSource) }, compiled);
  const state = await commitWithState(workspace, compiled.spec, [record], { artifactOverwrite: true });
  printResult({ ...resultFor("update", [record], state), backupPath, updateMode: "in-place-edit" });
}

async function validateCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 1) usage("validate requires <artifact>");
  const artifactPath = path.resolve(positional[0]);
  const format = resolveSingleFormat(options.formats, artifactPath);
  const source = await readText(artifactPath);
  const content = parseArtifact(format, source, artifactPath);
  const quality = validateArtifact(format, content, { profile: resolveQualityProfile(options.quality) });
  printResult({ command: "validate", path: artifactPath, format, quality, ...quality });
  if (!quality.valid) process.exitCode = 1;
}

async function checkCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 1) usage("check requires <spec.json>");
  const specPath = path.resolve(positional[0]);
  const spec = normalizeSpec(await readJson(specPath));
  const qualityProfile = resolveQualityProfile(options.quality);
  const formats = options.formats.length > 0
    ? resolveCompileFormats(options.formats, null)
    : ["excalidraw", "mermaid", "drawio"];
  const outputs = formats.map((format) => {
    const compiled = compileArtifact(spec, format, { qualityProfile });
    return {
      format,
      formatVersion: compiled.formatVersion,
      quality: compiled.quality,
    };
  });
  let repositoryEvidence = null;
  let evidenceDiagnostics = [];
  if (hasRepositoryEvidence(spec)) {
    try {
      repositoryEvidence = await verifyRepositoryEvidence(spec, path.resolve(options.repo ?? process.cwd()));
    } catch (error) {
      evidenceDiagnostics = error.details?.diagnostics ?? [];
    }
  }
  const diagnostics = [
    ...outputs.flatMap((output) => output.quality.diagnostics.map((item) => ({ ...item, format: output.format }))),
    ...evidenceDiagnostics,
  ];
  const valid = outputs.every((output) => output.quality.valid) && evidenceDiagnostics.length === 0;
  printResult({
    command: "check",
    specPath,
    schemaVersion: spec.schemaVersion,
    specHash: hashSpec(spec),
    qualityProfile,
    valid,
    diagnostics,
    outputs,
    repositoryEvidence,
  });
  if (!valid) process.exitCode = 1;
}

async function guideCommand(args) {
  const { positional, options } = parseArgs(args);
  if (options.formats.length > 0 || options.workspace || options.quality || options.repo) {
    fail("cli.option", "guide does not accept format, workspace, quality, or repo options.");
  }
  if (positional.length === 0) usage("guide requires a diagram description or type");
  const query = positional.join(" ");
  printResult({ command: "guide", query, ...recommendChartType(query) });
}

async function recoverCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length < 2) usage("recover requires <spec.json> <artifact> [artifact ...]");
  if (options.formats.length > 0 || options.quality || options.repo || options.conflict || options.missing
    || options.overwrite || options.write) {
    fail("cli.option", "recover accepts only --workspace.");
  }
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const specPath = path.resolve(positional[0]);
  const spec = normalizeSpec(await readJson(specPath));
  const inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  if (inspection.document) {
    fail("artifact.alreadyManaged", `Document ${spec.documentId} already exists in the workspace manifest.`);
  }
  const expectedSpecHash = hashSpec(spec);
  const records = [];
  const seenFormats = new Set();
  for (const value of positional.slice(1)) {
    const artifactPath = path.resolve(value);
    const format = inferFormat(artifactPath);
    if (!format) fail("format.required", `Cannot infer a supported format from ${artifactPath}.`);
    if (seenFormats.has(format)) fail("format.duplicate", `recover accepts at most one artifact per format: ${format}.`);
    seenFormats.add(format);
    const source = await readText(artifactPath);
    const content = parseArtifact(format, source, artifactPath);
    const quality = validateArtifact(format, content, { requireMetadata: true });
    if (!quality.valid) fail("artifact.invalid", `Artifact failed validation: ${artifactPath}`, { format, errors: quality.errors });
    const metadata = readArtifactMetadata(format, content);
    if (!metadata || metadata.documentId !== spec.documentId || metadata.specHash !== expectedSpecHash) {
      fail("artifact.identityMismatch", `Artifact identity does not match the supplied DiagramSpec: ${artifactPath}`, {
        format,
        expected: { documentId: spec.documentId, specHash: expectedSpecHash },
        actual: metadata,
      });
    }
    records.push({
      format,
      path: artifactPath,
      source,
      formatVersion: Number(metadata.formatVersion ?? (format === "excalidraw" ? 2 : 1)),
      sha256: digest(source),
      bytes: Buffer.byteLength(source, "utf8"),
      quality,
    });
  }
  const state = await saveWorkspaceState(workspace, spec, records);
  printResult({
    command: "recover",
    recovered: true,
    outputs: records.map((record) => ({
      format: record.format,
      path: record.path,
      formatVersion: record.formatVersion,
      sha256: record.sha256,
      bytes: record.bytes,
    })),
    ...state,
  });
}

async function migrateCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 1) usage("migrate requires <spec.json>");
  const specPath = path.resolve(positional[0]);
  const input = await readJson(specPath);
  const migrated = normalizeSpec(migrateSpec(input, { targetVersion: 2 }));
  let backupPath = null;
  if (options.write === true) {
    backupPath = await backupSpec(specPath);
    await writeJsonAtomic(specPath, migrated);
  }
  printResult({ command: "migrate", specPath, backupPath, spec: migrated });
}

function parseArgs(args) {
  const positional = [];
  const options = { formats: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--workspace") options.workspace = requiredValue(args, ++index, value);
    else if (value === "--format") options.formats.push(requiredValue(args, ++index, value));
    else if (value === "--conflict") options.conflict = requiredValue(args, ++index, value);
    else if (value === "--missing") options.missing = requiredValue(args, ++index, value);
    else if (value === "--quality") options.quality = requiredValue(args, ++index, value);
    else if (value === "--repo") options.repo = requiredValue(args, ++index, value);
    else if (value === "--overwrite") options.overwrite = true;
    else if (value === "--write") options.write = true;
    else if (value.startsWith("--")) fail("cli.option", `Unknown option: ${value}`);
    else positional.push(value);
  }
  return { positional, options };
}

function resolveCompileFormats(values, outputPath) {
  if (values.length === 0) {
    const inferred = inferFormat(outputPath);
    if (!inferred) {
      fail("format.required", "Output format must be specified with --format or a supported output extension.");
    }
    return [inferred];
  }
  return [...new Set(values.map((value) => {
    const format = normalizeFormat(value);
    if (!format) fail("format.unsupported", `Unsupported output format: ${value}`);
    return format;
  }))];
}

function resolveSingleFormat(values, artifactPath) {
  if (values.length > 1) fail("format.multiple", "validate accepts at most one --format value.");
  const requested = values[0] ?? null;
  try {
    return resolveFormat({ format: requested, outputPath: artifactPath, strict: requested != null }).name;
  } catch (error) {
    const code = requested || inferFormat(artifactPath) ? "format.extensionMismatch" : "format.required";
    fail(code, error.message);
  }
}

function recordFor(output, compiled) {
  const source = serializeArtifact(output.format, compiled.content);
  return {
    ...output,
    format: output.format,
    path: output.path,
    content: compiled.content,
    source,
    sha256: digest(source),
    bytes: Buffer.byteLength(source, "utf8"),
    formatVersion: compiled.formatVersion,
    quality: compiled.quality,
    warnings: compiled.warnings,
  };
}

function resultFor(commandName, records, state) {
  const outputs = records.map((record) => ({
    format: record.format,
    path: record.path,
    formatVersion: record.formatVersion,
    quality: record.quality,
    sha256: record.sha256,
    bytes: record.bytes,
  }));
  return {
    command: commandName,
    outputs,
    ...(outputs.length === 1 ? {
      output: outputs[0].path,
      format: outputs[0].format,
      quality: outputs[0].quality,
      receipt: { sha256: outputs[0].sha256, bytes: outputs[0].bytes },
    } : {}),
    ...state,
  };
}

async function commitWithState(workspace, spec, records, options = {}) {
  const prepared = await prepareWorkspaceState(workspace, spec, records, {
    detachFormats: options.detachFormats ?? [],
  });
  if (prepared.manifestBackupNeeded) await backupSpec(prepared.manifestPath);
  const artifactRecords = records.map((record) => ({
    ...record,
    overwrite: options.artifactOverwrite === true,
  }));
  await writeArtifactsAtomic([...artifactRecords, ...prepared.stateRecords]);
  for (const record of records) {
    const source = await readText(record.path);
    const actualHash = digest(source);
    const actualBytes = Buffer.byteLength(source, "utf8");
    if (actualHash !== record.sha256 || actualBytes !== record.bytes) {
      fail("artifact.receiptMismatch", `Final artifact does not match its delivery receipt: ${record.path}`, {
        path: record.path,
        expectedHash: record.sha256,
        actualHash,
        expectedBytes: record.bytes,
        actualBytes,
      });
    }
  }
  return {
    manifestPath: prepared.manifestPath,
    specPath: prepared.specPath,
    specHash: prepared.specHash,
  };
}

function hasLayoutWarnings(quality) {
  return quality.warnings.some((warning) =>
    ["visual.nodeOverlap", "visual.textOverflow", "visual.edgeThroughNode", "geometry.nodeOverlap", "geometry.edgeThroughNode"].includes(warning.code),
  );
}

function resolveQualityProfile(value) {
  const profile = String(value ?? "standard").toLowerCase();
  if (!["standard", "showcase"].includes(profile)) {
    fail("quality.profile", "--quality must be standard or showcase.");
  }
  return profile;
}

function digest(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function assertQuality(quality, format) {
  if (!quality.valid) {
    fail("quality.failed", `Quality gate failed for ${format}.`, { format, errors: quality.errors });
  }
}

function summarizeArtifacts(artifacts) {
  return {
    artifacts: artifacts.map((artifact) => ({
      format: artifact.format,
      path: artifact.path,
      state: artifact.state,
    })),
  };
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value == null || value.startsWith("--")) fail("cli.optionValue", `${option} requires a value.`);
  return value;
}

function fail(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function firstExisting(paths) {
  for (const filePath of paths) {
    if (await exists(filePath)) return filePath;
  }
  return null;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function usage(error = null) {
  const message = [
    ...(error ? [error, ""] : []),
    "Usage:",
    "  node runtime/cli.mjs compile <spec.json> [output] --format <format> [--format <format> ...] [--workspace <dir>] [--quality <standard|showcase>] [--overwrite]",
    "  node runtime/cli.mjs sync <spec.json> [--format <format> ...] [--workspace <dir>] [--quality <standard|showcase>] [--conflict <overwrite|copy>] [--missing <regenerate|detach>]",
    "  node runtime/cli.mjs update <existing.excalidraw> <spec.json> [--workspace <dir>] [--quality <standard|showcase>]",
    "  node runtime/cli.mjs validate <artifact> [--format <format>] [--quality <standard|showcase>]",
    "  node runtime/cli.mjs check <spec.json> [--format <format> ...] [--quality <standard|showcase>] [--repo <dir>]",
    "  node runtime/cli.mjs guide <description-or-type>",
    "  node runtime/cli.mjs recover <spec.json> <artifact> [artifact ...] [--workspace <dir>]",
    "  node runtime/cli.mjs migrate <spec.json> [--write]",
  ].join("\n");
  fail("cli.usage", message);
}
