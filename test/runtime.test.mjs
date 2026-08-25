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
  EXTENDED_CHART_TYPES,
  migrateSpec,
  normalizeSpec,
} from "../runtime/lib/core.mjs";
import { validateDocument } from "../runtime/lib/quality.mjs";
import { backupDocument, readJson, writeJsonAtomic } from "../runtime/lib/workspace.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all chart types are classified", () => {
  assert.equal(CHART_TYPES.size, 22);
  assert.equal(CORE_CHART_TYPES.size, 8);
  assert.equal(EXTENDED_CHART_TYPES.size, 14);
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
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.type, "flowchart");
  assert.throws(() => normalizeSpec({ schemaVersion: 99 }), /Unsupported DiagramSpec/u);
});

test("backup retention keeps ten newest versions", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-backup-"));
  const source = path.join(workspace, "source.excalidraw");
  await writeJsonAtomic(source, { type: "excalidraw", version: 2, elements: [] });
  for (let index = 0; index < 12; index += 1) {
    await backupDocument(workspace, "doc", source);
  }
  const backups = await fs.readdir(path.join(workspace, ".drawing-master", "backups", "doc"));
  assert.equal(backups.length, 10);
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
