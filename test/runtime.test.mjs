import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compileSpec } from "../runtime/lib/compiler.mjs";
import {
  CHART_TYPES,
  CORE_CHART_TYPES,
  DEFAULT_FONT_SIZES,
  EXTENDED_CHART_TYPES,
  migrateSpec,
  normalizeSpec,
} from "../runtime/lib/core.mjs";
import { validateDocument } from "../runtime/lib/quality.mjs";
import {
  backupDocument,
  inspectWorkspaceDocument,
  readJson,
  readWorkspaceManifest,
  saveWorkspaceState,
  writeArtifactsAtomic,
  writeJsonAtomic,
} from "../runtime/lib/workspace.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all chart types are classified", () => {
  assert.equal(CHART_TYPES.size, 22);
  assert.equal(CORE_CHART_TYPES.size, 9);
  assert.equal(EXTENDED_CHART_TYPES.size, 13);
});

for (const type of CORE_CHART_TYPES) {
  test(`core golden spec compiles deterministically: ${type}`, async () => {
    const spec = await readJson(path.join(root, "fixtures", "specs", `${type}.json`));
    const hashes = await readJson(path.join(root, "fixtures", "golden-hashes.json"));
    const first = compileSpec(spec).document;
    const second = compileSpec(spec).document;
    assert.deepEqual(first, second);
    const quality = validateDocument(first);
    assert.equal(quality.valid, true, JSON.stringify(quality.errors));
    assert.equal(
      crypto.createHash("sha256").update(JSON.stringify(first)).digest("hex"),
      hashes[type],
    );
    const generatedNodes = first.elements.filter((element) => element.customData?.drawingMaster?.kind === "node");
    assert.equal(generatedNodes.length, spec.nodes.length);
  });
}

for (const type of EXTENDED_CHART_TYPES) {
  test(`extended type smoke test: ${type}`, () => {
    const spec = simpleSpec(type);
    if (type === "swot") spec.nodes.push({ id: "c", label: "C" }, { id: "d", label: "D" });
    const { document } = compileSpec(spec);
    const quality = validateDocument(document);
    assert.equal(quality.valid, true, JSON.stringify(quality.errors));
  });
}

test("format snapshot contains current binding, text-container and frame relationships", async () => {
  const fixture = await readJson(path.join(root, "fixtures", "excalidraw-v2", "minimal-shape-arrow-frame.excalidraw"));
  const quality = validateDocument(fixture);
  assert.equal(quality.valid, true, JSON.stringify(quality.errors));
  const text = fixture.elements.find((element) => element.type === "text");
  const arrow = fixture.elements.find((element) => element.type === "arrow");
  const frame = fixture.elements.find((element) => element.type === "frame");
  assert.equal(text.containerId, "shape-a");
  assert.deepEqual(arrow.startBinding.fixedPoint, [1, 0.5]);
  assert.equal(arrow.startBinding.mode, "orbit");
  assert.equal("children" in frame, false);
});

test("compiler writes separate bound text and bidirectional references", async () => {
  const spec = await readJson(path.join(root, "fixtures", "specs", "flowchart.json"));
  const { document } = compileSpec(spec);
  const node = document.elements.find((element) => element.customData?.drawingMaster?.semanticId === "start" && element.type !== "text");
  const label = document.elements.find((element) => element.containerId === node.id);
  const arrowRef = node.boundElements.find((item) => item.type === "arrow");
  assert.ok(label);
  assert.equal(label.type, "text");
  assert.ok(arrowRef);
  const arrow = document.elements.find((element) => element.id === arrowRef.id);
  assert.equal(arrow.startBinding.elementId, node.id);
});

test("compiler uses readable default font sizes and honors explicit overrides", () => {
  const input = simpleSpec("flowchart");
  input.edges[0].label = "next";
  const defaults = compileSpec(input).document;
  const nodeLabel = defaults.elements.find((element) => element.customData?.drawingMaster?.kind === "node-label");
  const edgeLabel = defaults.elements.find((element) => element.customData?.drawingMaster?.kind === "edge-label");
  assert.equal(nodeLabel.fontSize, DEFAULT_FONT_SIZES.node);
  assert.equal(edgeLabel.fontSize, DEFAULT_FONT_SIZES.edge);

  input.nodes[0].style = { fontSize: 30 };
  input.edges[0].style = { fontSize: 22 };
  const explicit = compileSpec(input).document;
  const explicitNode = explicit.elements.find((element) => element.customData?.drawingMaster?.semanticId === "a" && element.type === "text");
  const explicitEdge = explicit.elements.find((element) => element.customData?.drawingMaster?.kind === "edge-label");
  assert.equal(explicitNode.fontSize, 30);
  assert.equal(explicitEdge.fontSize, 22);
});

test("update preserves an existing Excalidraw font size unless the spec overrides it", () => {
  const input = simpleSpec("flowchart");
  const existing = compileSpec(input).document;
  const existingLabel = existing.elements.find((element) => element.customData?.drawingMaster?.semanticId === "a" && element.type === "text");
  existingLabel.fontSize = 31;

  const preserved = compileSpec(input, { existingDocument: existing }).document;
  assert.equal(preserved.elements.find((element) => element.id === existingLabel.id).fontSize, 31);

  input.nodes[0].style = { fontSize: 26 };
  const overridden = compileSpec(input, { existingDocument: existing }).document;
  assert.equal(overridden.elements.find((element) => element.id === existingLabel.id).fontSize, 26);
});

for (const type of ["gantt", "pyramid", "funnel"]) {
  test(`${type} expands long labels without overlapping rows`, () => {
    const input = simpleSpec(type);
    input.nodes[0].label = "这是一个需要自动换行并扩展高度的长标签";
    input.nodes[1].label = "第二个同样需要保持清晰可读的长标签";
    const compiled = compileSpec(input);
    const [first, second] = [...compiled.layout.nodes.values()].sort((a, b) => a.y - b.y);
    assert.ok(first.height > 54);
    assert.ok(second.y >= first.y + first.height);
    const quality = validateDocument(compiled.document);
    assert.equal(quality.warnings.some((warning) => warning.code === "visual.textOverflow"), false);
  });
}

test("update preserves unknown elements, unknown fields, styles and positions", () => {
  const baseSpec = simpleSpec("flowchart");
  const first = compileSpec(baseSpec).document;
  const node = first.elements.find((element) => element.customData?.drawingMaster?.kind === "node");
  node.strokeColor = "#ff0000";
  node.x = 777;
  node.vendorField = { keep: true };
  const unknown = {
    id: "manual-freedraw",
    type: "freedraw",
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    points: [[0, 0], [3, 4]],
    customData: { owner: "user" },
  };
  first.elements.unshift(unknown);
  const changed = structuredClone(baseSpec);
  changed.nodes[0].label = "Renamed A";
  const updated = compileSpec(changed, { existingDocument: first }).document;
  const keptNode = updated.elements.find((element) => element.id === node.id);
  const keptUnknown = updated.elements.find((element) => element.id === unknown.id);
  const label = updated.elements.find((element) => element.containerId === node.id);
  assert.equal(keptNode.strokeColor, "#ff0000");
  assert.equal(keptNode.x, 777);
  assert.deepEqual(keptNode.vendorField, { keep: true });
  assert.deepEqual(keptUnknown, unknown);
  assert.equal(label.originalText, "Renamed A");
});

test("published Excalidraw examples match compiler output", async () => {
  for (const [specName, exampleName] of [
    ["flowchart.json", "login-flow.excalidraw"],
    ["architecture.json", "microservice-architecture.excalidraw"],
  ]) {
    const input = await readJson(path.join(root, "fixtures", "specs", specName));
    const example = await readJson(path.join(root, "examples", exampleName));
    assert.deepEqual(example, compileSpec(input).document);
  }
});

test("large diagrams split all generated nodes into frames", () => {
  const nodes = Array.from({ length: 31 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}` }));
  const spec = {
    schemaVersion: 1,
    documentId: "large-diagram",
    title: "Large",
    type: "flowchart",
    nodes,
    edges: [],
  };
  const { document } = compileSpec(spec);
  const generatedNodes = document.elements.filter((element) => element.customData?.drawingMaster?.kind === "node");
  assert.ok(generatedNodes.every((element) => element.frameId));
  assert.equal(document.elements.filter((element) => element.type === "frame").length, 2);
  assert.equal(validateDocument(document).valid, true);
});

test("known schema migrates and unknown newer schema is rejected", () => {
  const migrated = migrateSpec({
    chartType: "flowchart",
    documentId: "old",
    title: "Old",
    nodes: [{ id: "a", label: "A" }],
    connections: [],
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.type, "flowchart");
  assert.equal(migrated.nodes[0].kind, "process");
  assert.throws(() => normalizeSpec({ schemaVersion: 99 }), /Unsupported DiagramSpec/u);
});

test("v1 migration canonicalizes ER cardinalities and Gantt durations", () => {
  const er = migrateSpec({
    schemaVersion: 1,
    documentId: "legacy-er",
    title: "Legacy ER",
    type: "er",
    nodes: [{ id: "a", label: "A", kind: "entity" }, { id: "b", label: "B", kind: "entity" }],
    edges: [{ id: "ab", from: "a", to: "b", relationship: "owns", cardinality: { from: "1", to: "N" } }],
  });
  assert.deepEqual(er.edges[0].data, {
    relationship: "owns",
    fromCardinality: "one",
    toCardinality: "zero-or-more",
  });
  assert.equal("relationship" in er.edges[0], false);
  assert.equal("cardinality" in er.edges[0], false);

  const gantt = migrateSpec({
    schemaVersion: 1,
    documentId: "legacy-gantt",
    title: "Legacy Gantt",
    type: "gantt",
    nodes: [{ id: "task", label: "Task", kind: "task", data: { start: "2026-09-07", duration: "3d" } }],
    edges: [],
  });
  assert.equal(gantt.nodes[0].data.durationDays, 3);
  assert.equal("duration" in gantt.nodes[0].data, false);
});

test("backup retention keeps ten newest versions", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-backup-"));
  const source = path.join(workspace, "source.excalidraw");
  await writeJsonAtomic(source, { type: "excalidraw", version: 2, elements: [] });
  let backupPath;
  for (let index = 0; index < 12; index += 1) {
    backupPath = await backupDocument(workspace, "doc", source);
  }
  const backups = await fs.readdir(path.dirname(backupPath));
  assert.equal(backups.length, 10);
});

test("manifest v1 migrates in memory and persists only with a successful state save", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-manifest-"));
  const stateRoot = path.join(workspace, ".drawing-master");
  const specsRoot = path.join(stateRoot, "specs");
  await fs.mkdir(specsRoot, { recursive: true });
  const spec = simpleSpec("flowchart");
  const specPath = path.join(specsRoot, `${spec.documentId}.json`);
  const artifactPath = path.join(workspace, "legacy.excalidraw");
  await writeJsonAtomic(specPath, normalizeSpec(spec));
  await writeJsonAtomic(artifactPath, compileSpec(spec).document);
  await writeJsonAtomic(path.join(stateRoot, "manifest.json"), {
    manifestVersion: 1,
    documents: {
      [spec.documentId]: {
        documentId: spec.documentId,
        path: "legacy.excalidraw",
        specPath: `.drawing-master/specs/${spec.documentId}.json`,
        schemaVersion: 1,
        compiledAt: "2026-01-01T00:00:00.000Z",
      },
    },
  });

  const loaded = await readWorkspaceManifest(workspace);
  assert.equal(loaded.migrated, true);
  assert.ok(loaded.manifest.documents[spec.documentId].artifacts.excalidraw);
  assert.equal((await readJson(path.join(stateRoot, "manifest.json"))).manifestVersion, 1);

  await saveWorkspaceState(workspace, spec, artifactPath);
  assert.equal((await readJson(path.join(stateRoot, "manifest.json"))).manifestVersion, 2);
  const backups = (await fs.readdir(stateRoot)).filter((name) => name.startsWith("manifest.json.bak-"));
  assert.equal(backups.length, 1);
});

test("workspace inspection reports current, stale, modified, and missing artifacts", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-states-"));
  const spec = normalizeSpec(simpleSpec("flowchart"));
  const artifactPath = path.join(workspace, "state.excalidraw");
  await writeJsonAtomic(artifactPath, compileSpec(spec).document);
  await saveWorkspaceState(workspace, spec, artifactPath);
  let inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  assert.equal(inspection.artifacts.excalidraw.state, "current");

  const changed = structuredClone(spec);
  changed.nodes[0].label = "Changed";
  const changedArtifact = path.join(workspace, "state.mmd");
  await fs.writeFile(changedArtifact, "flowchart TB\n", "utf8");
  await saveWorkspaceState(workspace, changed, {
    path: changedArtifact,
    format: "mermaid",
    source: "flowchart TB\n",
    formatVersion: 1,
  });
  inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  assert.equal(inspection.artifacts.excalidraw.state, "stale");
  assert.equal(inspection.artifacts.mermaid.state, "current");

  await fs.appendFile(changedArtifact, "%% modified\n", "utf8");
  inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  assert.equal(inspection.artifacts.mermaid.state, "modified");

  await fs.rm(artifactPath);
  inspection = await inspectWorkspaceDocument(workspace, spec.documentId);
  assert.equal(inspection.artifacts.excalidraw.state, "missing");
});

test("workspace state keeps prototype-like document ids and collision-safe spec paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-identities-"));
  const ids = ["__proto__", "a/b", "a?b"];
  const specPaths = [];
  for (const documentId of ids) {
    const spec = { ...simpleSpec("flowchart"), documentId };
    const artifactPath = path.join(workspace, `${documentId.replace(/[^a-z]/gu, "-") || "doc"}-${specPaths.length}.excalidraw`);
    await writeJsonAtomic(artifactPath, compileSpec(spec).document);
    specPaths.push((await saveWorkspaceState(workspace, spec, artifactPath)).specPath);
  }
  assert.equal(new Set(specPaths).size, ids.length);
  const manifest = await readJson(path.join(workspace, ".drawing-master", "manifest.json"));
  assert.deepEqual(Object.keys(manifest.documents).sort(), [...ids].sort());
});

test("batch staging failures remove temporary files", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-staging-"));
  const blockedParent = path.join(workspace, "blocked");
  await fs.writeFile(blockedParent, "file", "utf8");
  const first = path.join(workspace, "first.mmd");
  await assert.rejects(writeArtifactsAtomic([
    { path: first, source: "first\n" },
    { path: path.join(blockedParent, "second.mmd"), source: "second\n" },
  ]));
  const entries = await fs.readdir(workspace);
  assert.equal(entries.some((name) => name.includes(".tmp-")), false);
  await assert.rejects(fs.access(first));
});

test("batch writes reject case-insensitive duplicate paths on Windows", async (context) => {
  if (process.platform !== "win32") context.skip("Windows-specific path semantics");
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-case-"));
  await assert.rejects(writeArtifactsAtomic([
    { path: path.join(workspace, "A.mmd"), source: "first\n" },
    { path: path.join(workspace, "a.mmd"), source: "second\n" },
  ]), /Duplicate output path/u);
});

test("batch writes reject stale overwrite preconditions without changing the file", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-concurrent-"));
  const output = path.join(workspace, "artifact.mmd");
  await fs.writeFile(output, "current\n", "utf8");
  await assert.rejects(writeArtifactsAtomic([{
    path: output,
    source: "replacement\n",
    overwrite: true,
    expectedHash: "0".repeat(64),
  }]), (error) => error.code === "artifact.concurrentModification");
  assert.equal(await fs.readFile(output, "utf8"), "current\n");
});

test("workspace inspection rejects managed paths that escape the workspace", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-path-"));
  const stateRoot = path.join(workspace, ".drawing-master");
  await fs.mkdir(stateRoot, { recursive: true });
  await writeJsonAtomic(path.join(stateRoot, "manifest.json"), {
    manifestVersion: 2,
    documents: {
      unsafe: {
        documentId: "unsafe",
        specPath: ".drawing-master/specs/unsafe.json",
        specHash: "0".repeat(64),
        schemaVersion: 1,
        artifacts: {
          mermaid: { format: "mermaid", path: "../outside.mmd", artifactHash: null, specHash: null },
        },
      },
    },
  });
  await assert.rejects(inspectWorkspaceDocument(workspace, "unsafe"), /escapes the workspace/u);
});

function simpleSpec(type) {
  return {
    schemaVersion: 1,
    documentId: `smoke-${type}`,
    title: type,
    type,
    nodes: [
      { id: "a", label: "A", kind: type === "venn" ? "concept" : "process" },
      { id: "b", label: "B", kind: type === "fishbone" ? "result" : "process" },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
  };
}
