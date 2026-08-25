#!/usr/bin/env node

import path from "node:path";
import { compileSpec } from "./lib/compiler.mjs";
import { migrateSpec, normalizeSpec } from "./lib/core.mjs";
import { validateDocument } from "./lib/quality.mjs";
import {
  backupDocument,
  backupSpec,
  nextOutputPath,
  readJson,
  saveWorkspaceState,
  writeJsonAtomic,
} from "./lib/workspace.mjs";

const [command, ...rawArgs] = process.argv.slice(2);

try {
  if (command === "compile") await compileCommand(rawArgs);
  else if (command === "update") await updateCommand(rawArgs);
  else if (command === "validate") await validateCommand(rawArgs);
  else if (command === "migrate") await migrateCommand(rawArgs);
  else usage(command ? `Unknown command: ${command}` : null);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

async function compileCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length < 1) usage("compile requires <spec.json> [output.excalidraw]");
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const input = await readJson(path.resolve(positional[0]));
  let spec = normalizeSpec(input);
  let compiled = compileSpec(spec);
  let quality = validateDocument(compiled.document);

  for (let pass = 0; pass < 2 && hasLayoutWarnings(quality); pass += 1) {
    spec = {
      ...spec,
      layout: {
        ...spec.layout,
        gapX: Number(spec.layout.gapX ?? 180) * 1.25,
        gapY: Number(spec.layout.gapY ?? 120) * 1.25,
      },
    };
    compiled = compileSpec(spec);
    quality = validateDocument(compiled.document);
  }
  assertQuality(quality);

  const output = await nextOutputPath(workspace, compiled.spec, positional[1] ?? null);
  if (options.overwrite !== true && positional[1] && await fileExists(output)) {
    throw new Error(`Refusing to overwrite ${output}; pass --overwrite or omit the output path.`);
  }
  await writeJsonAtomic(output, compiled.document);
  const state = await saveWorkspaceState(workspace, compiled.spec, output);
  printResult({ command: "compile", output, ...state, quality });
}

async function updateCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length < 2) usage("update requires <existing.excalidraw> <spec.json>");
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const output = path.resolve(positional[0]);
  const existing = await readJson(output);
  const input = await readJson(path.resolve(positional[1]));
  const compiled = compileSpec(input, { existingDocument: existing });
  const quality = validateDocument(compiled.document);
  assertQuality(quality);
  const backupPath = await backupDocument(workspace, compiled.spec.documentId, output);
  await writeJsonAtomic(output, compiled.document);
  const state = await saveWorkspaceState(workspace, compiled.spec, output);
  printResult({ command: "update", output, backupPath, ...state, quality });
}

async function validateCommand(args) {
  const { positional } = parseArgs(args);
  if (positional.length < 1) usage("validate requires <file.excalidraw>");
  const input = await readJson(path.resolve(positional[0]));
  const quality = validateDocument(input);
  process.stdout.write(`${JSON.stringify(quality, null, 2)}\n`);
  if (!quality.valid) process.exitCode = 1;
}

async function migrateCommand(args) {
  const { positional, options } = parseArgs(args);
  if (positional.length < 1) usage("migrate requires <spec.json>");
  const specPath = path.resolve(positional[0]);
  const input = await readJson(specPath);
  const migrated = normalizeSpec(migrateSpec(input));
  let backupPath = null;
  if (options.write === true) {
    backupPath = await backupSpec(specPath);
    await writeJsonAtomic(specPath, migrated);
  }
  printResult({ command: "migrate", specPath, backupPath, spec: migrated });
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--workspace") options.workspace = args[++index];
    else if (value === "--overwrite") options.overwrite = true;
    else if (value === "--write") options.write = true;
    else if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }
  return { positional, options };
}

function hasLayoutWarnings(quality) {
  return quality.warnings.some((warning) =>
    ["visual.nodeOverlap", "visual.textOverflow", "visual.edgeThroughNode"].includes(warning.code),
  );
}

function assertQuality(quality) {
  if (!quality.valid) {
    throw new Error(`Quality gate failed:\n${quality.errors.map((error) => `- ${error.message}`).join("\n")}`);
  }
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function fileExists(filePath) {
  try {
    await import("node:fs/promises").then((fs) => fs.access(filePath));
    return true;
  } catch {
    return false;
  }
}

function usage(error = null) {
  const message = [
    ...(error ? [error, ""] : []),
    "Usage:",
    "  node runtime/cli.mjs compile <spec.json> [output.excalidraw] [--workspace <dir>] [--overwrite]",
    "  node runtime/cli.mjs update <existing.excalidraw> <spec.json> [--workspace <dir>]",
    "  node runtime/cli.mjs validate <file.excalidraw>",
    "  node runtime/cli.mjs migrate <spec.json> [--write]",
  ].join("\n");
  throw new Error(message);
}
