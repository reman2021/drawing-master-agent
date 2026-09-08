import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CORE_CHART_TYPES,
  DEFAULT_FONT_SIZES,
  EXTENDED_CHART_TYPES,
} from "../runtime/lib/core.mjs";
import { readArtifactMetadata } from "../runtime/lib/artifact.mjs";
import { compileSpec } from "../runtime/lib/compiler.mjs";
import { compileDrawio } from "../runtime/lib/drawio.mjs";
import {
  assertFormatMatchesPath,
  hashSpec,
  inferFormat,
  resolveFormat,
} from "../runtime/lib/formats.mjs";
import { compileMermaid } from "../runtime/lib/mermaid.mjs";
import { validateDrawio } from "../runtime/lib/quality-drawio.mjs";
import { validateMermaid } from "../runtime/lib/quality-mermaid.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("format registry resolves aliases, compatible extensions, and strict mismatches", () => {
  assert.equal(resolveFormat("draw.io").name, "drawio");
  assert.equal(inferFormat("diagram.MERMAID"), "mermaid");
  assert.equal(assertFormatMatchesPath("mermaid", "diagram.mmd").extension, ".mmd");
  assert.throws(() => assertFormatMatchesPath("drawio", "diagram.mmd"), /does not match/u);
});

test("Mermaid compiles a safe deterministic flowchart", () => {
  const first = compileMermaid(spec("flowchart"));
  const second = compileMermaid(spec("flowchart"));
  assert.equal(first.content, second.content);
  assert.match(first.content, /^%% drawing-master /u);
  assert.match(first.content, /flowchart TB/u);
  assert.equal(validateMermaid(first.content).valid, true);
});

test("Mermaid escapes unsafe labels and rejects active syntax", () => {
  const input = spec("flowchart");
  input.nodes[0].label = '<script>alert("x")</script>\n%%{init}%%';
  input.edges[0].label = "click A javascript:evil";
  const compiled = compileMermaid(input);
  assert.doesNotMatch(compiled.content, /<script|%%\{|^\s*click\b/imu);
  assert.match(compiled.content, /#60;script#62;/u);
  assert.equal(validateMermaid(compiled.content).valid, true);
  assert.equal(validateMermaid(`${compiled.content}\nclick n_a href`).valid, false);
  assert.equal(validateMermaid(`${compiled.content.trimEnd()}; click n_a "https://example.com"\n`).valid, false);
  assert.equal(validateMermaid(`${compiled.content.trimEnd()}\rclick n_a "https://example.com"\n`).valid, false);
  assert.equal(validateMermaid(`${compiled.content.trimEnd()}; classDef unsafe fill:red\n`).valid, false);
  assert.equal(validateMermaid(`${compiled.content}this is not Mermaid syntax\n`).valid, false);
});

test("Mermaid neutralizes statement and comment delimiters in labels", () => {
  for (const type of ["sequence", "class", "timeline"]) {
    const input = spec(type);
    input.nodes[0].label = "Alpha; click injected callback # value";
    if (type === "timeline") {
      input.edges = [];
      input.nodes.forEach((node, index) => { node.data = { time: `T${index + 1}` }; });
    }
    const compiled = compileMermaid(input);
    assert.doesNotMatch(compiled.content, /Alpha; click/u);
    assert.match(compiled.content, /Alpha#59; click injected callback #35; value/u);
    assert.equal(validateMermaid(compiled.content, { requireMetadata: true }).valid, true);
  }
});

test("Mermaid uses native mindmap only for a tree and otherwise degrades", () => {
  const native = spec("mindmap");
  native.nodes[0].kind = "root";
  native.edges[0].label = "";
  const nativeResult = compileMermaid(native);
  assert.match(nativeResult.content, /\nmindmap\n/u);
  assert.ok(nativeResult.warnings.some((item) => item.code === "format.experimental"));

  native.edges.push({ id: "cycle", from: "b", to: "a" });
  const degraded = compileMermaid(native);
  assert.match(degraded.content, /\nflowchart TB\n/u);
  assert.ok(degraded.warnings.some((item) => item.code === "format.degraded"));
});

test("draw.io output is escaped, single-page, and has valid cell references", () => {
  const input = spec("swimlane");
  input.title = 'A & B <review> "page"';
  input.lanes = [{ id: "lane-a", label: "Lane <A>" }];
  input.nodes[0].laneId = "lane-a";
  input.nodes[1].laneId = "lane-a";
  input.nodes[0].label = "A <script> & value";
  const first = compileDrawio(input);
  const second = compileDrawio(input);
  assert.equal(first.content, second.content);
  assert.match(first.content, /compressed="false"/u);
  assert.match(first.content, /A &amp; B &lt;review&gt; &quot;page&quot;/u);
  assert.doesNotMatch(first.content, /<script\b|<!DOCTYPE/iu);
  assert.equal(validateDrawio(first.content).valid, true, JSON.stringify(validateDrawio(first.content).errors));

  const broken = first.content.replace(/ source="[^"]+"/u, ' source="missing-cell"');
  const quality = validateDrawio(broken);
  assert.equal(quality.valid, false);
  assert.ok(quality.errors.some((item) => item.code === "cell.reference"));
});

test("every format exposes matching embedded document identity and spec hash", () => {
  const input = spec("flowchart");
  const expected = compileMermaid(input).spec;
  const artifacts = [
    ["excalidraw", compileSpec(input).document],
    ["mermaid", compileMermaid(input).content],
    ["drawio", compileDrawio(input).content],
  ];
  for (const [format, content] of artifacts) {
    const metadata = readArtifactMetadata(format, content);
    assert.equal(metadata.documentId, expected.documentId);
    assert.equal(metadata.specHash, hashSpec(expected));
  }
});

test("draw.io serializes readable default and explicit font sizes", () => {
  const input = spec("flowchart");
  input.groups = [{ id: "group-a", label: "Group" }];
  input.nodes[0].groupId = "group-a";
  input.annotations = [{ id: "note", text: "Note" }];
  const defaults = compileDrawio(input).content;
  assert.match(defaults, new RegExp(`fontSize=${DEFAULT_FONT_SIZES.node};`, "u"));
  assert.match(defaults, new RegExp(`fontSize=${DEFAULT_FONT_SIZES.edge};`, "u"));
  assert.match(defaults, new RegExp(`fontSize=${DEFAULT_FONT_SIZES.annotation};`, "u"));
  assert.match(defaults, new RegExp(`fontSize=${DEFAULT_FONT_SIZES.frame};fontStyle=1;`, "u"));

  input.nodes[0].style = { fontSize: 30 };
  input.edges[0].style = { fontSize: 22 };
  input.annotations[0].style = { fontSize: 19 };
  const explicit = compileDrawio(input).content;
  assert.match(explicit, /fontSize=30;/u);
  assert.match(explicit, /fontSize=22;/u);
  assert.match(explicit, /fontSize=19;/u);
});

test("v2 Gantt durationDays compiles to native Mermaid and finite draw.io geometry", () => {
  const input = {
    schemaVersion: 2,
    documentId: "gantt-v2",
    title: "Gantt v2",
    type: "gantt",
    nodes: [
      { id: "design", label: "Design", kind: "task", order: 0, data: { start: "2026-09-07", durationDays: 3 } },
      { id: "build", label: "Build", kind: "task", order: 1, data: { start: "2026-09-10", end: "2026-09-14" } },
    ],
    edges: [],
  };
  const mermaid = compileMermaid(input);
  const drawio = compileDrawio(input);
  assert.match(mermaid.content, /2026-09-07, 3d/u);
  assert.doesNotMatch(mermaid.content, /flowchart/u);
  assert.equal(validateMermaid(mermaid.content, { requireMetadata: true }).valid, true);
  assert.equal(validateDrawio(drawio.content, { requireMetadata: true }).valid, true);
});

test("draw.io consumes the same deterministic ports and route waypoints as layout", () => {
  const input = spec("flowchart");
  input.nodes[1].position = { x: 320, y: 180 };
  input.edges[0].fromSide = "right";
  input.edges[0].toSide = "left";
  input.edges[0].via = [{ x: 240, y: 40 }, { x: 280, y: 220 }];
  const compiled = compileDrawio(input);
  const route = compiled.layout.routes.get("ab");
  assert.match(compiled.content, new RegExp(`exitX=${route.startFixedPoint[0]};exitY=${route.startFixedPoint[1]};`, "u"));
  for (const [x, y] of route.absolutePoints.slice(1, -1)) {
    assert.match(compiled.content, new RegExp(`<mxPoint x="${x}" y="${y}"/>`, "u"));
  }
});

for (const type of CORE_CHART_TYPES) {
  test(`core format hashes remain stable: ${type}`, async () => {
    const input = JSON.parse(await fs.readFile(path.join(root, "fixtures", "specs", `${type}.json`), "utf8"));
    const hashes = JSON.parse(await fs.readFile(path.join(root, "fixtures", "golden-format-hashes.json"), "utf8"));
    const mermaid = compileMermaid(input);
    const drawio = compileDrawio(input);
    assert.equal(validateMermaid(mermaid.content, { requireMetadata: true }).valid, true);
    assert.equal(validateDrawio(drawio.content, { requireMetadata: true }).valid, true);
    assert.equal(digest(mermaid.content), hashes.mermaid[type]);
    assert.equal(digest(drawio.content), hashes.drawio[type]);
  });
}

for (const type of EXTENDED_CHART_TYPES) {
  test(`extended formats compile safely: ${type}`, () => {
    const mermaid = compileMermaid(spec(type));
    const drawio = compileDrawio(spec(type));
    assert.equal(validateMermaid(mermaid.content, { requireMetadata: true }).valid, true);
    assert.equal(validateDrawio(drawio.content, { requireMetadata: true }).valid, true);
  });
}

test("format compilers preserve partitions and annotations", () => {
  const input = spec("flowchart");
  input.groups = [{ id: "group-a", label: "安全边界" }];
  input.nodes[0].groupId = "group-a";
  input.annotations = [{ id: "note", text: "仅限受管产物", position: { x: 20, y: 30 } }];
  const mermaid = compileMermaid(input);
  const drawio = compileDrawio(input);
  assert.match(mermaid.content, /subgraph group_/u);
  assert.match(mermaid.content, /安全边界/u);
  assert.match(mermaid.content, /仅限受管产物/u);
  assert.match(drawio.content, /dm-mx-frame-group-a/u);
  assert.match(drawio.content, /dm-mx-annotation-note/u);
});

test("representative format fixtures match compiler output", async () => {
  const input = JSON.parse(await fs.readFile(path.join(root, "fixtures", "specs", "flowchart.json"), "utf8"));
  const mermaid = await fs.readFile(path.join(root, "fixtures", "mermaid", "flowchart.mmd"), "utf8");
  const drawio = await fs.readFile(path.join(root, "fixtures", "drawio", "flowchart.drawio"), "utf8");
  assert.equal(mermaid, compileMermaid(input).content);
  assert.equal(drawio, compileDrawio(input).content);
});

test("published Mermaid and draw.io examples match compiler output", async () => {
  const input = JSON.parse(await fs.readFile(path.join(root, "fixtures", "specs", "flowchart.json"), "utf8"));
  const mermaid = await fs.readFile(path.join(root, "examples", "login-flow.mmd"), "utf8");
  const drawio = await fs.readFile(path.join(root, "examples", "login-flow.drawio"), "utf8");
  assert.equal(mermaid, compileMermaid(input).content);
  assert.equal(drawio, compileDrawio(input).content);
});

test("draw.io validator rejects malformed XML and single-quoted event attributes", async () => {
  const fixture = await fs.readFile(path.join(root, "fixtures", "drawio", "flowchart.drawio"), "utf8");
  const malformed = fixture.replace("</root>", "<orphan></root>");
  assert.equal(validateDrawio(malformed).valid, false);
  const active = fixture.replace('<mxCell id="0"/>', '<mxCell id="0" onclick=\'alert(1)\'/>' );
  const quality = validateDrawio(active);
  assert.equal(quality.valid, false);
  assert.ok(quality.errors.some((item) => item.code === "safety.event"));
  const truncated = fixture.replace('<mxCell id="0"/>', '<mxCell id="0" probe=">" link=\'https://example.com\'/>' );
  assert.equal(validateDrawio(truncated).valid, false);
  const duplicate = fixture.replace('<mxCell id="0"/>', '<mxCell id="0" id=\'duplicate\'/>' );
  assert.equal(validateDrawio(duplicate).valid, false);
  const illegalEntity = fixture.replace('value="开始"', 'value="开始&#0;"');
  assert.equal(validateDrawio(illegalEntity).valid, false);
  const wrongHierarchy = fixture.replace('</root>', '</root><mxCell id="outside"/>');
  assert.equal(validateDrawio(wrongHierarchy).valid, false);
  const rawControl = fixture.replace('value="开始"', `value="开始${String.fromCodePoint(1)}"`);
  assert.equal(validateDrawio(rawControl).valid, false);
  const rawLessThan = fixture.replace('value="开始"', 'value="bad<value"');
  assert.equal(validateDrawio(rawLessThan).valid, false);
});

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function spec(type) {
  return {
    schemaVersion: 1,
    documentId: `formats-${type}`,
    title: `${type} example`,
    type,
    nodes: [
      { id: "a", label: "Alpha", kind: "process" },
      { id: "b", label: "Beta", kind: "process" },
    ],
    edges: [{ id: "ab", from: "a", to: "b", label: "next" }],
  };
}
