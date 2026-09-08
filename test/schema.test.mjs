import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertSpecSchema, validateSpecSchema } from "../runtime/lib/schema-validator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("v2 schema is a strict JSON Schema contract", async () => {
  const source = await fs.readFile(path.join(root, "runtime", "schemas", "diagram-spec-v2.schema.json"), "utf8");
  const schema = JSON.parse(source);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.$defs.node.additionalProperties, false);
  assert.equal(schema.$defs.edge.additionalProperties, false);
  assert.equal(schema.$defs.nodeData.additionalProperties, false);
  assert.equal(schema.$defs.edgeData.additionalProperties, false);
  assert.ok(schema.allOf.length >= 9);
});

test("v2 rejects unknown fields at every strict contract level", () => {
  const cases = [
    ["$.unexpected", (spec) => { spec.unexpected = true; }, "diagram", "strict-fields"],
    ["$.nodes[0].unexpected", (spec) => { spec.nodes[0].unexpected = true; }, "node", "a"],
    ["$.nodes[0].position.unexpected", (spec) => { spec.nodes[0].position.unexpected = true; }, "node", "a"],
    ["$.nodes[0].size.unexpected", (spec) => { spec.nodes[0].size.unexpected = true; }, "node", "a"],
    ["$.nodes[0].style.unexpected", (spec) => { spec.nodes[0].style.unexpected = true; }, "node", "a"],
    ["$.nodes[0].data.unexpected", (spec) => { spec.nodes[0].data.unexpected = true; }, "node", "a"],
    ["$.edges[0].unexpected", (spec) => { spec.edges[0].unexpected = true; }, "edge", "ab"],
    ["$.edges[0].style.unexpected", (spec) => { spec.edges[0].style.unexpected = true; }, "edge", "ab"],
    ["$.edges[0].data.unexpected", (spec) => { spec.edges[0].data.unexpected = true; }, "edge", "ab"],
    ["$.groups[0].unexpected", (spec) => { spec.groups[0].unexpected = true; }, "group", "g1"],
    ["$.lanes[0].unexpected", (spec) => { spec.lanes[0].unexpected = true; }, "lane", "l1"],
    ["$.annotations[0].unexpected", (spec) => { spec.annotations[0].unexpected = true; }, "annotation", "note"],
    ["$.layout.unexpected", (spec) => { spec.layout.unexpected = true; }, "diagram", "strict-fields"],
    ["$.theme.unexpected", (spec) => { spec.theme.unexpected = true; }, "diagram", "strict-fields"],
  ];

  for (const [expectedPath, mutate, expectedKind, expectedId] of cases) {
    const spec = richV2Spec();
    mutate(spec);
    const diagnostic = validateSpecSchema(spec, { version: 2 })
      .find((item) => item.code === "spec.schema.unknownField" && item.subject.path === expectedPath);
    assert.ok(diagnostic, `missing unknown-field diagnostic for ${expectedPath}`);
    assert.deepEqual(Object.keys(diagnostic), ["code", "severity", "message", "subject", "evidence", "supportedFixes"]);
    assert.deepEqual(diagnostic.subject.identity, { kind: expectedKind, id: expectedId });
    assert.equal(diagnostic.severity, "error");
    assert.ok(Array.isArray(diagnostic.supportedFixes));
  }
});

test("v2 reports required fields, formats, ranges, duplicates, and references", () => {
  const spec = baseV2("flowchart");
  spec.nodes.push({
    id: "a",
    label: "Duplicate",
    kind: "process",
    position: { x: Number.NaN, y: 0 },
    size: { width: 0, height: 10 },
  });
  spec.edges.push({ id: "bad id", from: "missing", to: "a", kind: "unknown" });
  delete spec.title;
  const diagnostics = validateSpecSchema(spec);
  const codes = new Set(diagnostics.map((item) => item.code));
  assert.ok(codes.has("spec.schema.required"));
  assert.ok(codes.has("spec.schema.type"));
  assert.ok(codes.has("spec.schema.range"));
  assert.ok(codes.has("spec.schema.pattern"));
  assert.ok(codes.has("spec.schema.enum"));
  assert.ok(codes.has("spec.schema.duplicateId"));
  assert.ok(codes.has("spec.schema.reference"));
  const reference = diagnostics.find((item) => item.code === "spec.schema.reference");
  assert.deepEqual(reference.subject, { path: "$.edges[0].from", identity: { kind: "edge", id: "bad id" } });
});

test("mindmap requires one connected single-root tree", () => {
  const spec = validSpecs().mindmap;
  spec.edges[0] = { id: "m1", from: "child", to: "root", kind: "directed" };
  assertDiagnostic(spec, "spec.semantic.mindmap.tree");
  spec.nodes.push({ id: "other-root", label: "Other", kind: "root" });
  assertDiagnostic(spec, "spec.semantic.mindmap.root");
});

test("swimlane requires lanes and complete node assignment", () => {
  const noLanes = validSpecs().swimlane;
  noLanes.lanes = [];
  assertDiagnostic(noLanes, "spec.semantic.swimlane.lanes");
  const unassigned = validSpecs().swimlane;
  delete unassigned.nodes[0].laneId;
  assertDiagnostic(unassigned, "spec.semantic.swimlane.assignment");
});

test("sequence requires explicit unique participant and message order", () => {
  const spec = validSpecs().sequence;
  spec.edges[1].order = spec.edges[0].order;
  assertDiagnostic(spec, "spec.semantic.sequence.orderDuplicate");
  spec.nodes[1].order = spec.nodes[0].order;
  assertDiagnostic(spec, "spec.semantic.sequence.orderDuplicate");
});

test("state requires initial and final node semantics", () => {
  const noFinal = validSpecs().state;
  noFinal.nodes[1].kind = "state";
  assertDiagnostic(noFinal, "spec.semantic.state.final");
  const incomingInitial = validSpecs().state;
  incomingInitial.edges.push({ id: "back", from: "end", to: "start", kind: "transition" });
  assertDiagnostic(incomingInitial, "spec.semantic.state.initialIncoming");
  assertDiagnostic(incomingInitial, "spec.semantic.state.finalOutgoing");
});

test("class diagrams only accept class nodes and class relationships", () => {
  const spec = validSpecs().class;
  spec.nodes[0].kind = "service";
  spec.edges[0].kind = "directed";
  assertDiagnostic(spec, "spec.semantic.class.nodeKind");
  assertDiagnostic(spec, "spec.semantic.class.relationship");
});

test("ER relationships require canonical endpoint cardinalities", () => {
  const spec = validSpecs().er;
  delete spec.edges[0].data.fromCardinality;
  assertDiagnostic(spec, "spec.semantic.er.cardinality");
  spec.edges[0].data.toCardinality = "N";
  assertDiagnostic(spec, "spec.schema.enum");
});

test("Gantt validates calendar dates and exactly one finish form", () => {
  const invalidDate = validSpecs().gantt;
  invalidDate.nodes[0].data.start = "2026-02-30";
  assertDiagnostic(invalidDate, "spec.schema.format");
  assertDiagnostic(invalidDate, "spec.semantic.gantt.start");

  const both = validSpecs().gantt;
  both.nodes[0].data.end = "2026-09-10";
  assertDiagnostic(both, "spec.semantic.gantt.finish");
});

test("timeline requires exactly one time or ISO date", () => {
  const missing = validSpecs().timeline;
  missing.nodes[0].data = { section: "History" };
  assertDiagnostic(missing, "spec.semantic.timeline.time");
  const both = validSpecs().timeline;
  both.nodes[0].data.time = "Morning";
  assertDiagnostic(both, "spec.semantic.timeline.time");
});

test("dataflow enforces node and edge kinds", () => {
  const spec = validSpecs().dataflow;
  spec.nodes[0].kind = "service";
  spec.edges[0].kind = "directed";
  assertDiagnostic(spec, "spec.semantic.dataflow.nodeKind");
  assertDiagnostic(spec, "spec.semantic.dataflow.edgeKind");
});

test("valid v1 remains loose and all representative v2 specs pass", () => {
  const v1 = {
    schemaVersion: 1,
    documentId: "legacy",
    type: "flowchart",
    unknownExtension: { keep: true },
    nodes: [{ id: "legacy node", vendorField: true }],
    edges: [],
  };
  assert.deepEqual(validateSpecSchema(v1), []);
  for (const [type, spec] of Object.entries(validSpecs())) {
    assert.deepEqual(validateSpecSchema(spec, { version: 2 }), [], `${type} should be valid`);
  }
});

test("assertSpecSchema throws the unified diagnostics and returns valid input", () => {
  const valid = baseV2("flowchart");
  assert.equal(assertSpecSchema(valid, { version: 2 }), valid);
  assert.throws(
    () => assertSpecSchema({ ...valid, extra: true }, { version: 2 }),
    (error) => {
      assert.equal(error.code, "spec.schema");
      assert.ok(Array.isArray(error.details.diagnostics));
      assert.equal(error.details.diagnostics[0].subject.path, "$.extra");
      return true;
    },
  );
});

test("v2 accepts deterministic routing and repository evidence fields", () => {
  const spec = baseV2("architecture");
  spec.provenance = {
    repository: {
      url: "https://github.com/example/project.git",
      revision: "a".repeat(40),
    },
  };
  spec.nodes[0].sources = [{ path: "src/index.mjs", line: 1, endLine: 2, label: "Entry" }];
  spec.nodes.push({ id: "b", label: "B", kind: "component" });
  spec.nodes[0].kind = "component";
  spec.edges.push({
    id: "ab",
    from: "a",
    to: "b",
    kind: "directed",
    fromSide: "right",
    toSide: "left",
    via: [{ x: 100, y: 50 }],
    labelAt: 0.4,
  });
  assert.deepEqual(validateSpecSchema(spec, { version: 2 }), []);
});

function assertDiagnostic(spec, code) {
  const diagnostics = validateSpecSchema(spec, { version: 2 });
  assert.ok(diagnostics.some((item) => item.code === code), `${code} not found in ${JSON.stringify(diagnostics)}`);
}

function baseV2(type) {
  return {
    schemaVersion: 2,
    documentId: `valid-${type}`,
    title: `Valid ${type}`,
    type,
    nodes: [{ id: "a", label: "A", kind: "process" }],
    edges: [],
  };
}

function richV2Spec() {
  return {
    schemaVersion: 2,
    documentId: "strict-fields",
    title: "Strict fields",
    type: "flowchart",
    seed: 7,
    groups: [{ id: "g1", label: "Group", order: 0 }],
    lanes: [{ id: "l1", label: "Lane", order: 0 }],
    nodes: [
      {
        id: "a",
        label: "A",
        kind: "process",
        groupId: "g1",
        laneId: "l1",
        position: { x: 10, y: 20 },
        size: { width: 200, height: 80 },
        style: { backgroundColor: "#ffffff", strokeColor: "#000000", textColor: "#111111", fontSize: 24, fontFamily: 5 },
        data: { time: "Now" },
      },
      { id: "b", label: "B", kind: "process" },
    ],
    edges: [{
      id: "ab",
      from: "a",
      to: "b",
      kind: "directed",
      style: { strokeColor: "#000000", textColor: "#111111", labelBackgroundColor: "#ffffff", fontSize: 18 },
      data: { relationship: "next" },
    }],
    annotations: [{ id: "note", text: "Note", position: { x: 0, y: 0 }, size: { width: 100, height: 40 }, style: { textAlign: "left" } }],
    layout: { direction: "TB", margin: 100, gapX: 100, gapY: 100, nodeWidth: 200, nodeHeight: 80, framePadding: 40, columns: 2, reflow: false },
    theme: { background: "#ffffff", text: "#111111", stroke: "#222222", primary: "#eeeeee", palette: ["#ffffff"] },
  };
}

function validSpecs() {
  return {
    flowchart: baseV2("flowchart"),
    mindmap: {
      ...baseV2("mindmap"),
      nodes: [{ id: "root", label: "Root", kind: "root" }, { id: "child", label: "Child", kind: "concept" }],
      edges: [{ id: "m1", from: "root", to: "child", kind: "directed" }],
    },
    swimlane: {
      ...baseV2("swimlane"),
      lanes: [{ id: "lane-a", label: "Lane A", order: 0 }],
      nodes: [{ id: "step", label: "Step", kind: "process", laneId: "lane-a" }],
    },
    sequence: {
      ...baseV2("sequence"),
      nodes: [
        { id: "user", label: "User", kind: "actor", order: 0 },
        { id: "system", label: "System", kind: "service", order: 1 },
      ],
      edges: [
        { id: "request", from: "user", to: "system", kind: "directed", label: "Request", order: 0 },
        { id: "response", from: "system", to: "user", kind: "return", label: "Response", order: 1 },
      ],
    },
    state: {
      ...baseV2("state"),
      nodes: [{ id: "start", label: "Start", kind: "start" }, { id: "end", label: "End", kind: "end" }],
      edges: [{ id: "transition", from: "start", to: "end", kind: "transition" }],
    },
    class: {
      ...baseV2("class"),
      nodes: [{ id: "base", label: "Base", kind: "class" }, { id: "child", label: "Child", kind: "class" }],
      edges: [{ id: "inherit", from: "child", to: "base", kind: "inheritance" }],
    },
    er: {
      ...baseV2("er"),
      nodes: [{ id: "user", label: "User", kind: "entity" }, { id: "order", label: "Order", kind: "entity" }],
      edges: [{
        id: "owns",
        from: "user",
        to: "order",
        kind: "relationship",
        data: { relationship: "owns", fromCardinality: "one", toCardinality: "zero-or-more" },
      }],
    },
    gantt: {
      ...baseV2("gantt"),
      nodes: [{ id: "task", label: "Task", kind: "task", data: { start: "2026-09-07", durationDays: 3, section: "Work" } }],
    },
    timeline: {
      ...baseV2("timeline"),
      nodes: [{ id: "release", label: "Release", kind: "event", data: { date: "2026-09-07" } }],
    },
    dataflow: {
      ...baseV2("dataflow"),
      nodes: [
        { id: "process", label: "Process", kind: "process" },
        { id: "store", label: "Store", kind: "data-store" },
      ],
      edges: [{ id: "flow", from: "process", to: "store", kind: "flow" }],
    },
    infographic: {
      ...baseV2("infographic"),
      nodes: [{ id: "fact", label: "Fact", kind: "item" }],
      layout: { columns: 1 },
    },
  };
}
