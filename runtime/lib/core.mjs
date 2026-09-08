import path from "node:path";
import { assertSpecSchema } from "./schema-validator.mjs";

export const SCHEMA_VERSION = 2;
export const RUNTIME_VERSION = "0.3.0";

export const DEFAULT_FONT_SIZES = Object.freeze({
  node: 24,
  edge: 18,
  annotation: 18,
  frame: 20,
});

export const CORE_CHART_TYPES = new Set([
  "flowchart",
  "architecture",
  "sequence",
  "er",
  "mindmap",
  "class",
  "state",
  "swimlane",
  "dataflow",
]);

export const EXTENDED_CHART_TYPES = new Set([
  "orgchart",
  "gantt",
  "timeline",
  "tree",
  "network",
  "concept",
  "fishbone",
  "swot",
  "pyramid",
  "funnel",
  "venn",
  "matrix",
  "infographic",
]);

export const CHART_TYPES = new Set([
  ...CORE_CHART_TYPES,
  ...EXTENDED_CHART_TYPES,
]);

export const DEFAULT_THEME = Object.freeze({
  background: "#ffffff",
  text: "#1e293b",
  stroke: "#334155",
  primary: "#dbeafe",
  secondary: "#dcfce7",
  accent: "#ffedd5",
  muted: "#f1f5f9",
  danger: "#fee2e2",
  palette: ["#dbeafe", "#dcfce7", "#ffedd5", "#f3e8ff", "#fef3c7"],
});

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hash32(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stableId(kind, documentId, semanticId) {
  const slug = slugify(semanticId).slice(0, 24) || kind;
  return `dm-${kind}-${slug}-${hash32(`${documentId}:${kind}:${semanticId}`).toString(36)}`;
}

export function stableSeed(...parts) {
  return (hash32(parts.join(":")) % 2147483646) + 1;
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function outputSlug(spec) {
  return slugify(spec.title || spec.documentId || "diagram") || "diagram";
}

export function commonElement({
  id,
  type,
  x,
  y,
  width,
  height,
  documentId,
  semanticKind,
  semanticId,
  frameId = null,
  updated = 1,
  schemaVersion = SCHEMA_VERSION,
}) {
  return {
    id,
    type,
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    angle: 0,
    strokeColor: DEFAULT_THEME.stroke,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: stableSeed(documentId, semanticKind, semanticId, "seed"),
    version: 1,
    versionNonce: stableSeed(documentId, semanticKind, semanticId, "nonce"),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId,
    boundElements: [],
    updated,
    link: null,
    locked: false,
    customData: {
      drawingMaster: {
        documentId,
        kind: semanticKind,
        semanticId,
        schemaVersion,
      },
    },
  };
}

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function migrateSpec(input, options = {}) {
  const spec = clone(input);
  const version = spec.schemaVersion ?? 0;
  const targetVersion = typeof options === "number"
    ? options
    : options.targetVersion ?? SCHEMA_VERSION;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Unsupported DiagramSpec schemaVersion ${version}; runtime supports ${SCHEMA_VERSION}.`,
    );
  }

  if (version === 0) {
    spec.type = spec.type ?? spec.chartType ?? "flowchart";
    spec.edges = spec.edges ?? spec.connections ?? [];
    delete spec.chartType;
    delete spec.connections;
    spec.schemaVersion = 1;
  }

  if (![1, 2].includes(targetVersion) || targetVersion < spec.schemaVersion) {
    throw new Error(`Unsupported DiagramSpec migration target ${targetVersion}.`);
  }
  if (spec.schemaVersion === 1 && targetVersion === 2) {
    const migrated = migrateV1ToV2(spec);
    assertSpecSchema(migrated, { version: 2 });
    return migrated;
  }

  return spec;
}

export function normalizeSpec(input) {
  const declaredVersion = input?.schemaVersion ?? 0;
  const spec = migrateSpec(input, { targetVersion: declaredVersion === 0 ? 1 : declaredVersion });
  assertSpecSchema(spec, { version: spec.schemaVersion });
  spec.title = String(spec.title ?? "Untitled diagram");
  spec.type = String(spec.type ?? "flowchart").toLowerCase();
  spec.documentId = String(
    spec.documentId ?? `doc-${slugify(spec.title) || hash32(JSON.stringify(spec.nodes ?? []))}`,
  );
  spec.seed = Number.isInteger(spec.seed) ? spec.seed : stableSeed(spec.documentId);
  spec.nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  spec.edges = Array.isArray(spec.edges) ? spec.edges : [];
  spec.groups = Array.isArray(spec.groups) ? spec.groups : [];
  spec.lanes = Array.isArray(spec.lanes) ? spec.lanes : [];
  spec.annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  spec.layout = spec.layout && typeof spec.layout === "object" ? spec.layout : {};
  spec.theme = {
    ...DEFAULT_THEME,
    ...(spec.theme && typeof spec.theme === "object" ? spec.theme : {}),
  };

  spec.nodes = spec.nodes.map((node, index) => ({
    ...node,
    id: String(node.id ?? `node-${index + 1}`),
    label: String(node.label ?? node.name ?? node.id ?? `Node ${index + 1}`),
    kind: String(node.kind ?? "process"),
  }));

  spec.edges = spec.edges.map((edge, index) => ({
    ...edge,
    id: String(edge.id ?? `edge-${index + 1}`),
    from: String(edge.from ?? ""),
    to: String(edge.to ?? ""),
    label: edge.label == null ? "" : String(edge.label),
    kind: String(edge.kind ?? "directed"),
  }));

  const problems = validateSpec(spec);
  if (problems.length > 0) {
    throw new Error(`Invalid DiagramSpec:\n- ${problems.join("\n- ")}`);
  }
  return spec;
}

export function validateSpec(spec) {
  const problems = [];
  if (![1, 2].includes(spec.schemaVersion)) {
    problems.push("schemaVersion must be 1 or 2");
  }
  if (!spec.documentId || typeof spec.documentId !== "string") {
    problems.push("documentId must be a non-empty string");
  }
  if (!CHART_TYPES.has(spec.type)) {
    problems.push(`type must be one of: ${[...CHART_TYPES].join(", ")}`);
  }
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    problems.push("nodes must contain at least one node");
    return problems;
  }

  const nodeIds = new Set();
  for (const node of spec.nodes) {
    if (!node.id) problems.push("every node must have an id");
    if (nodeIds.has(node.id)) problems.push(`duplicate node id: ${node.id}`);
    nodeIds.add(node.id);
    if (!node.label) problems.push(`node ${node.id} must have a label`);
    if (node.position) {
      if (!isFiniteNumber(node.position.x) || !isFiniteNumber(node.position.y)) {
        problems.push(`node ${node.id} has an invalid position`);
      }
    }
  }

  const edgeIds = new Set();
  for (const edge of spec.edges) {
    if (!edge.id) problems.push("every edge must have an id");
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) problems.push(`edge ${edge.id} has unknown from node ${edge.from}`);
    if (!nodeIds.has(edge.to)) problems.push(`edge ${edge.id} has unknown to node ${edge.to}`);
  }

  const groupIds = new Set();
  for (const group of spec.groups) {
    if (!group.id) problems.push("every group must have an id");
    if (groupIds.has(group.id)) problems.push(`duplicate group id: ${group.id}`);
    groupIds.add(group.id);
  }
  for (const node of spec.nodes) {
    if (node.groupId && !groupIds.has(node.groupId)) {
      problems.push(`node ${node.id} has unknown groupId ${node.groupId}`);
    }
  }

  const laneIds = new Set(spec.lanes.map((lane) => String(lane.id)));
  for (const node of spec.nodes) {
    if (node.laneId && !laneIds.has(String(node.laneId))) {
      problems.push(`node ${node.id} has unknown laneId ${node.laneId}`);
    }
  }
  return problems;
}

function migrateV1ToV2(input) {
  const spec = normalizeLegacyForMigration(input);
  spec.schemaVersion = 2;
  spec.nodes = spec.nodes.map((node, index) => ({
    ...node,
    id: String(node.id ?? `node-${index + 1}`),
    label: String(node.label ?? node.name ?? node.id ?? `Node ${index + 1}`),
    kind: String(node.kind ?? defaultNodeKind(spec.type, index, spec.nodes.length)),
  }));
  for (const node of spec.nodes) delete node.name;

  spec.edges = spec.edges.map((edge, index) => {
    const migrated = {
      ...edge,
      id: String(edge.id ?? `edge-${index + 1}`),
      from: String(edge.from ?? ""),
      to: String(edge.to ?? ""),
      kind: String(edge.kind ?? defaultEdgeKind(spec.type)),
    };
    if (edge.label != null) migrated.label = String(edge.label);
    if (spec.type === "sequence") migrated.order = Number.isInteger(edge.order) ? edge.order : index;
    if (spec.type === "er") {
      migrated.data = migrateErData(edge);
      delete migrated.relationship;
      delete migrated.cardinality;
    }
    return migrated;
  });
  if (spec.type === "sequence") {
    spec.nodes = spec.nodes.map((node, index) => ({
      ...node,
      order: Number.isInteger(node.order) ? node.order : index,
    }));
  }
  if (spec.type === "gantt") {
    spec.nodes = spec.nodes.map((node) => ({ ...node, data: migrateGanttData(node.data) }));
  }
  spec.groups = spec.groups.map((group, index) => ({
    ...group,
    id: String(group.id ?? `group-${index + 1}`),
    label: String(group.label ?? group.id ?? `Group ${index + 1}`),
  }));
  spec.lanes = spec.lanes.map((lane, index) => ({
    ...lane,
    id: String(lane.id ?? `lane-${index + 1}`),
    label: String(lane.label ?? lane.id ?? `Lane ${index + 1}`),
    order: Number.isInteger(lane.order) ? lane.order : index,
  }));
  spec.annotations = spec.annotations.map((annotation, index) => ({
    ...annotation,
    id: String(annotation.id ?? `annotation-${index + 1}`),
    text: String(annotation.text ?? ""),
  }));
  return spec;
}

function normalizeLegacyForMigration(input) {
  const spec = clone(input);
  spec.title = String(spec.title ?? "Untitled diagram");
  spec.type = String(spec.type ?? "flowchart").toLowerCase();
  spec.documentId = String(
    spec.documentId ?? `doc-${slugify(spec.title) || hash32(JSON.stringify(spec.nodes ?? []))}`,
  );
  spec.nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  spec.edges = Array.isArray(spec.edges) ? spec.edges : [];
  spec.groups = Array.isArray(spec.groups) ? spec.groups : [];
  spec.lanes = Array.isArray(spec.lanes) ? spec.lanes : [];
  spec.annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  return spec;
}

function defaultNodeKind(type, index, count) {
  if (type === "class") return "class";
  if (type === "er") return "entity";
  if (type === "architecture") return "component";
  if (type === "sequence") return "service";
  if (type === "mindmap") return index === 0 ? "root" : "concept";
  if (type === "state") return index === 0 ? "start" : index === count - 1 ? "end" : "state";
  if (type === "gantt") return "task";
  if (type === "timeline") return "event";
  return "process";
}

function defaultEdgeKind(type) {
  if (type === "class") return "association";
  if (type === "er") return "relationship";
  if (type === "state") return "transition";
  if (type === "dataflow") return "flow";
  return "directed";
}

function migrateErData(edge) {
  const data = { ...(edge.data ?? {}) };
  if (data.relationship == null && edge.relationship != null) data.relationship = String(edge.relationship);
  data.fromCardinality ??= edge.cardinality?.from;
  data.toCardinality ??= edge.cardinality?.to;
  if (data.fromCardinality != null) data.fromCardinality = canonicalCardinality(data.fromCardinality);
  if (data.toCardinality != null) data.toCardinality = canonicalCardinality(data.toCardinality);
  if (data.fromCardinality == null || data.toCardinality == null) {
    const match = String(edge.label ?? "").match(/^\s*([^:]+)\s*:\s*([^:]+)\s*$/u);
    if (match) {
      data.fromCardinality ??= canonicalCardinality(match[1]);
      data.toCardinality ??= canonicalCardinality(match[2]);
    }
  }
  return data;
}

function migrateGanttData(input) {
  const data = { ...(input ?? {}) };
  if (data.durationDays == null && data.duration != null) {
    const match = String(data.duration).match(/^(\d+)d$/u);
    const days = match ? Number(match[1]) : Number(data.duration);
    if (Number.isInteger(days) && days > 0) data.durationDays = days;
  }
  delete data.duration;
  return data;
}

function canonicalCardinality(value) {
  const token = String(value).trim().toLowerCase();
  if (["1", "one", "exactly-one"].includes(token)) return "one";
  if (["0..1", "zero-or-one", "optional"].includes(token)) return "zero-or-one";
  if (["1..*", "1..n", "one-or-more"].includes(token)) return "one-or-more";
  if (["*", "n", "many", "0..*", "0..n", "zero-or-more"].includes(token)) return "zero-or-more";
  return value;
}

export function readJsonPathHint(filePath) {
  return path.resolve(String(filePath));
}
