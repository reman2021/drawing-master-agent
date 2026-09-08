const CHART_TYPES = new Set([
  "flowchart", "architecture", "sequence", "er", "mindmap", "class", "state", "swimlane",
  "orgchart", "gantt", "timeline", "tree", "network", "dataflow", "concept", "fishbone",
  "swot", "pyramid", "funnel", "venn", "matrix", "infographic",
]);

const NODE_KINDS = new Set([
  "process", "decision", "start", "end", "actor", "service", "component", "entity",
  "attribute", "relation", "root", "concept", "class", "state", "result", "person",
  "role", "team", "task", "milestone", "event", "system", "database", "data-store",
  "external-entity", "input", "output", "category", "item",
]);

const EDGE_KINDS = new Set([
  "directed", "bidirectional", "association", "return", "inheritance", "aggregation",
  "composition", "flow", "dependency", "transition", "relationship",
]);

const CARDINALITIES = new Set(["one", "zero-or-one", "one-or-more", "zero-or-more"]);
const CLASS_RELATIONSHIPS = new Set(["association", "inheritance", "aggregation", "composition"]);
const DATAFLOW_KINDS = new Set(["process", "data-store", "external-entity"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

const TOP_FIELDS = new Set([
  "schemaVersion", "documentId", "title", "type", "seed", "nodes", "edges", "groups",
  "lanes", "annotations", "layout", "theme", "provenance",
]);
const NODE_FIELDS = new Set([
  "id", "label", "kind", "shape", "groupId", "laneId", "level", "order", "position",
  "size", "style", "data", "existingElementId", "sources",
]);
const EDGE_FIELDS = new Set([
  "id", "from", "to", "label", "kind", "order", "style", "data", "existingElementId",
  "startArrowhead", "endArrowhead", "fromSide", "toSide", "via", "labelAt",
]);
const GROUP_FIELDS = new Set(["id", "label", "order"]);
const LANE_FIELDS = new Set(["id", "label", "order"]);
const ANNOTATION_FIELDS = new Set(["id", "text", "position", "size", "style"]);
const POSITION_FIELDS = new Set(["x", "y"]);
const SIZE_FIELDS = new Set(["width", "height"]);
const NODE_STYLE_FIELDS = new Set(["backgroundColor", "strokeColor", "textColor", "fontSize", "fontFamily"]);
const EDGE_STYLE_FIELDS = new Set(["strokeColor", "textColor", "labelBackgroundColor", "fontSize", "fontFamily"]);
const ANNOTATION_STYLE_FIELDS = new Set(["textColor", "fontSize", "fontFamily", "textAlign"]);
const NODE_DATA_FIELDS = new Set(["start", "end", "durationDays", "section", "time", "date"]);
const EDGE_DATA_FIELDS = new Set(["relationship", "fromCardinality", "toCardinality"]);
const LAYOUT_FIELDS = new Set([
  "direction", "margin", "gapX", "gapY", "nodeWidth", "nodeHeight", "framePadding", "columns", "reflow",
]);
const THEME_FIELDS = new Set([
  "background", "text", "stroke", "primary", "secondary", "accent", "muted", "danger", "palette",
]);
const PROVENANCE_FIELDS = new Set(["repository"]);
const REPOSITORY_FIELDS = new Set(["url", "revision"]);
const SOURCE_FIELDS = new Set(["path", "line", "endLine", "label"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ARROWHEADS = new Set([null, "arrow", "bar", "dot", "triangle", "triangle_outline", "diamond", "diamond_outline"]);

/**
 * Validate a DiagramSpec without mutating it or loading a general-purpose schema engine.
 * The returned diagnostics have the same shape for structural and semantic failures.
 */
export function validateSpecSchema(input, options = {}) {
  const diagnostics = [];
  const declaredVersion = isObject(input) ? input.schemaVersion : undefined;
  const version = options.version ?? declaredVersion ?? 1;
  const rootIdentity = identity("diagram", isObject(input) && typeof input.documentId === "string" ? input.documentId : null);

  if (version !== 1 && version !== 2) {
    add(diagnostics, "spec.schema.version.unsupported", "$.schemaVersion", rootIdentity,
      "DiagramSpec version must be 1 or 2.", { expected: [1, 2], actual: version }, ["replace"]);
    return diagnostics;
  }
  if (declaredVersion !== undefined && declaredVersion !== version) {
    add(diagnostics, "spec.schema.version.mismatch", "$.schemaVersion", rootIdentity,
      `schemaVersion ${String(declaredVersion)} does not match requested version ${version}.`,
      { expected: version, actual: declaredVersion }, ["replace"]);
  }

  if (version === 1) validateV1(input, diagnostics, rootIdentity);
  else validateV2(input, diagnostics, rootIdentity);
  return diagnostics;
}

export function assertSpecSchema(input, options = {}) {
  const diagnostics = validateSpecSchema(input, options);
  if (diagnostics.length === 0) return input;
  const error = new Error(`Invalid DiagramSpec schema: ${diagnostics.length} error${diagnostics.length === 1 ? "" : "s"}.`);
  error.name = "DiagramSpecSchemaError";
  error.code = "spec.schema";
  error.details = { diagnostics };
  throw error;
}

function validateV2(spec, diagnostics, rootIdentity) {
  if (!expectObject(spec, "$", rootIdentity, diagnostics)) return;
  inspectFields(spec, TOP_FIELDS, ["schemaVersion", "documentId", "title", "type", "nodes", "edges"], "$", rootIdentity, diagnostics);

  if (spec.schemaVersion !== undefined && spec.schemaVersion !== 2) {
    valueError(diagnostics, "const", "$.schemaVersion", rootIdentity, 2, spec.schemaVersion);
  }
  if (spec.documentId !== undefined) validateId(spec.documentId, "$.documentId", rootIdentity, diagnostics);
  if (spec.title !== undefined) validateText(spec.title, "$.title", rootIdentity, diagnostics, { min: 1, max: 10000 });
  if (spec.type !== undefined) validateEnum(spec.type, CHART_TYPES, "$.type", rootIdentity, diagnostics);
  if (spec.seed !== undefined) validateInteger(spec.seed, "$.seed", rootIdentity, diagnostics, 1, 2147483647);

  validateCollection(spec.nodes, "nodes", validateNodeV2, diagnostics, rootIdentity, { minItems: 1 });
  validateCollection(spec.edges, "edges", validateEdgeV2, diagnostics, rootIdentity);
  validateCollection(spec.groups, "groups", validateGroupV2, diagnostics, rootIdentity, { optional: true });
  validateCollection(spec.lanes, "lanes", validateLaneV2, diagnostics, rootIdentity, { optional: true });
  validateCollection(spec.annotations, "annotations", validateAnnotationV2, diagnostics, rootIdentity, { optional: true });
  if (spec.layout !== undefined) validateLayout(spec.layout, "$.layout", rootIdentity, diagnostics);
  if (spec.theme !== undefined) validateTheme(spec.theme, "$.theme", rootIdentity, diagnostics);
  if (spec.provenance !== undefined) validateProvenance(spec.provenance, "$.provenance", rootIdentity, diagnostics);

  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) return;
  validateIdentitiesAndReferences(spec, diagnostics, rootIdentity);
  validateTypeSemantics(spec, diagnostics, rootIdentity);
}

function validateNodeV2(node, path, itemIdentity, diagnostics) {
  if (!expectObject(node, path, itemIdentity, diagnostics)) return;
  inspectFields(node, NODE_FIELDS, ["id", "label", "kind"], path, itemIdentity, diagnostics);
  if (node.id !== undefined) validateId(node.id, `${path}.id`, itemIdentity, diagnostics);
  if (node.label !== undefined) validateText(node.label, `${path}.label`, itemIdentity, diagnostics, { min: 1, max: 10000 });
  if (node.kind !== undefined) validateEnum(node.kind, NODE_KINDS, `${path}.kind`, itemIdentity, diagnostics);
  if (node.shape !== undefined) validateEnum(node.shape, new Set(["rectangle", "ellipse", "diamond"]), `${path}.shape`, itemIdentity, diagnostics);
  if (node.groupId !== undefined) validateId(node.groupId, `${path}.groupId`, itemIdentity, diagnostics);
  if (node.laneId !== undefined) validateId(node.laneId, `${path}.laneId`, itemIdentity, diagnostics);
  if (node.existingElementId !== undefined) validateId(node.existingElementId, `${path}.existingElementId`, itemIdentity, diagnostics);
  if (node.level !== undefined) validateInteger(node.level, `${path}.level`, itemIdentity, diagnostics, 0, 1000000);
  if (node.order !== undefined) validateInteger(node.order, `${path}.order`, itemIdentity, diagnostics, 0, 1000000);
  if (node.position !== undefined) validatePosition(node.position, `${path}.position`, itemIdentity, diagnostics);
  if (node.size !== undefined) validateSize(node.size, `${path}.size`, itemIdentity, diagnostics);
  if (node.style !== undefined) validateStyle(node.style, `${path}.style`, itemIdentity, diagnostics, NODE_STYLE_FIELDS);
  if (node.data !== undefined) validateNodeData(node.data, `${path}.data`, itemIdentity, diagnostics);
  if (node.sources !== undefined) validateSources(node.sources, `${path}.sources`, itemIdentity, diagnostics);
}

function validateEdgeV2(edge, path, itemIdentity, diagnostics) {
  if (!expectObject(edge, path, itemIdentity, diagnostics)) return;
  inspectFields(edge, EDGE_FIELDS, ["id", "from", "to", "kind"], path, itemIdentity, diagnostics);
  for (const field of ["id", "from", "to", "existingElementId"]) {
    if (edge[field] !== undefined) validateId(edge[field], `${path}.${field}`, itemIdentity, diagnostics);
  }
  if (edge.label !== undefined) validateText(edge.label, `${path}.label`, itemIdentity, diagnostics, { min: 0, max: 10000 });
  if (edge.kind !== undefined) validateEnum(edge.kind, EDGE_KINDS, `${path}.kind`, itemIdentity, diagnostics);
  if (edge.order !== undefined) validateInteger(edge.order, `${path}.order`, itemIdentity, diagnostics, 0, 1000000);
  if (edge.style !== undefined) validateStyle(edge.style, `${path}.style`, itemIdentity, diagnostics, EDGE_STYLE_FIELDS);
  if (edge.data !== undefined) validateEdgeData(edge.data, `${path}.data`, itemIdentity, diagnostics);
  for (const field of ["startArrowhead", "endArrowhead"]) {
    if (edge[field] !== undefined) validateEnum(edge[field], ARROWHEADS, `${path}.${field}`, itemIdentity, diagnostics);
  }
  for (const field of ["fromSide", "toSide"]) {
    if (edge[field] !== undefined) validateEnum(edge[field], SIDES, `${path}.${field}`, itemIdentity, diagnostics);
  }
  if (edge.via !== undefined) validateWaypoints(edge.via, `${path}.via`, itemIdentity, diagnostics);
  if (edge.labelAt !== undefined) validateLabelAt(edge.labelAt, `${path}.labelAt`, itemIdentity, diagnostics);
}

function validateProvenance(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, PROVENANCE_FIELDS, ["repository"], path, itemIdentity, diagnostics);
  if (!expectObject(value.repository, `${path}.repository`, itemIdentity, diagnostics)) return;
  inspectFields(value.repository, REPOSITORY_FIELDS, ["url", "revision"], `${path}.repository`, itemIdentity, diagnostics);
  if (value.repository.url !== undefined) validateText(value.repository.url, `${path}.repository.url`, itemIdentity, diagnostics, { min: 1, max: 2000 });
  if (value.repository.revision !== undefined) validatePattern(value.repository.revision, /^[0-9a-f]{40}$/iu, `${path}.repository.revision`, itemIdentity, diagnostics, "a full 40-character Git SHA");
}

function validateSources(value, path, itemIdentity, diagnostics) {
  if (!Array.isArray(value)) {
    typeError(diagnostics, path, itemIdentity, "array", value);
    return;
  }
  if (value.length < 1 || value.length > 3) {
    add(diagnostics, "spec.schema.range", path, itemIdentity, "sources must contain 1 to 3 references.",
      { expected: { minItems: 1, maxItems: 3 }, actual: value.length }, ["replace", "remove"]);
  }
  value.forEach((source, index) => {
    const sourcePath = `${path}[${index}]`;
    if (!expectObject(source, sourcePath, itemIdentity, diagnostics)) return;
    inspectFields(source, SOURCE_FIELDS, ["path"], sourcePath, itemIdentity, diagnostics);
    if (source.path !== undefined) validateRepositoryPath(source.path, `${sourcePath}.path`, itemIdentity, diagnostics);
    if (source.line !== undefined) validateInteger(source.line, `${sourcePath}.line`, itemIdentity, diagnostics, 1, 1000000000);
    if (source.endLine !== undefined) validateInteger(source.endLine, `${sourcePath}.endLine`, itemIdentity, diagnostics, 1, 1000000000);
    if (source.endLine !== undefined && source.line === undefined) {
      add(diagnostics, "spec.semantic.source.lineRequired", `${sourcePath}.endLine`, itemIdentity,
        "source.endLine requires source.line.", { endLine: source.endLine }, ["add", "remove"]);
    }
    if (Number.isInteger(source.line) && Number.isInteger(source.endLine) && source.endLine < source.line) {
      add(diagnostics, "spec.semantic.source.lineRange", sourcePath, itemIdentity,
        "source.endLine must not be less than source.line.", { line: source.line, endLine: source.endLine }, ["replace"]);
    }
    if (source.label !== undefined) validateText(source.label, `${sourcePath}.label`, itemIdentity, diagnostics, { min: 1, max: 500 });
  });
}

function validateRepositoryPath(value, path, itemIdentity, diagnostics) {
  const valid = typeof value === "string" && value.length > 0 && !value.includes("\\")
    && !value.startsWith("/") && !/^[a-z]:\//iu.test(value)
    && !value.split("/").some((segment) => ["", ".", ".."].includes(segment) || segment.toLowerCase() === ".git");
  if (!valid) add(diagnostics, "spec.schema.repositoryPath", path, itemIdentity,
    "Source path must be a safe repository-relative POSIX path.", { actual: value }, ["replace"]);
}

function validateWaypoints(value, path, itemIdentity, diagnostics) {
  if (!Array.isArray(value)) {
    typeError(diagnostics, path, itemIdentity, "array", value);
    return;
  }
  value.forEach((point, index) => validatePosition(point, `${path}[${index}]`, itemIdentity, diagnostics));
}

function validateLabelAt(value, path, itemIdentity, diagnostics) {
  if (isFiniteNumber(value)) {
    if (value < 0 || value > 1) rangeError(diagnostics, path, itemIdentity, 0, 1, value);
    return;
  }
  validatePosition(value, path, itemIdentity, diagnostics);
}

function validateGroupV2(group, path, itemIdentity, diagnostics) {
  if (!expectObject(group, path, itemIdentity, diagnostics)) return;
  inspectFields(group, GROUP_FIELDS, ["id", "label"], path, itemIdentity, diagnostics);
  if (group.id !== undefined) validateId(group.id, `${path}.id`, itemIdentity, diagnostics);
  if (group.label !== undefined) validateText(group.label, `${path}.label`, itemIdentity, diagnostics, { min: 1, max: 10000 });
  if (group.order !== undefined) validateInteger(group.order, `${path}.order`, itemIdentity, diagnostics, 0, 1000000);
}

function validateLaneV2(lane, path, itemIdentity, diagnostics) {
  if (!expectObject(lane, path, itemIdentity, diagnostics)) return;
  inspectFields(lane, LANE_FIELDS, ["id", "label", "order"], path, itemIdentity, diagnostics);
  if (lane.id !== undefined) validateId(lane.id, `${path}.id`, itemIdentity, diagnostics);
  if (lane.label !== undefined) validateText(lane.label, `${path}.label`, itemIdentity, diagnostics, { min: 1, max: 10000 });
  if (lane.order !== undefined) validateInteger(lane.order, `${path}.order`, itemIdentity, diagnostics, 0, 1000000);
}

function validateAnnotationV2(annotation, path, itemIdentity, diagnostics) {
  if (!expectObject(annotation, path, itemIdentity, diagnostics)) return;
  inspectFields(annotation, ANNOTATION_FIELDS, ["id", "text"], path, itemIdentity, diagnostics);
  if (annotation.id !== undefined) validateId(annotation.id, `${path}.id`, itemIdentity, diagnostics);
  if (annotation.text !== undefined) validateText(annotation.text, `${path}.text`, itemIdentity, diagnostics, { min: 1, max: 10000 });
  if (annotation.position !== undefined) validatePosition(annotation.position, `${path}.position`, itemIdentity, diagnostics);
  if (annotation.size !== undefined) validateSize(annotation.size, `${path}.size`, itemIdentity, diagnostics);
  if (annotation.style !== undefined) validateStyle(annotation.style, `${path}.style`, itemIdentity, diagnostics, ANNOTATION_STYLE_FIELDS);
}

function validatePosition(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, POSITION_FIELDS, ["x", "y"], path, itemIdentity, diagnostics);
  if (value.x !== undefined) validateNumber(value.x, `${path}.x`, itemIdentity, diagnostics, -1000000, 1000000);
  if (value.y !== undefined) validateNumber(value.y, `${path}.y`, itemIdentity, diagnostics, -1000000, 1000000);
}

function validateSize(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, SIZE_FIELDS, ["width", "height"], path, itemIdentity, diagnostics);
  if (value.width !== undefined) validateNumber(value.width, `${path}.width`, itemIdentity, diagnostics, Number.MIN_VALUE, 100000, true);
  if (value.height !== undefined) validateNumber(value.height, `${path}.height`, itemIdentity, diagnostics, Number.MIN_VALUE, 100000, true);
}

function validateStyle(value, path, itemIdentity, diagnostics, fields) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, fields, [], path, itemIdentity, diagnostics);
  for (const field of ["backgroundColor", "strokeColor", "textColor", "labelBackgroundColor"]) {
    if (value[field] !== undefined) validatePattern(value[field], COLOR_PATTERN, `${path}.${field}`, itemIdentity, diagnostics, "a #RRGGBB color");
  }
  if (value.fontSize !== undefined) validateNumber(value.fontSize, `${path}.fontSize`, itemIdentity, diagnostics, 8, 96);
  if (value.fontFamily !== undefined) validateInteger(value.fontFamily, `${path}.fontFamily`, itemIdentity, diagnostics, 1, 5);
  if (value.textAlign !== undefined) validateEnum(value.textAlign, new Set(["left", "center", "right"]), `${path}.textAlign`, itemIdentity, diagnostics);
}

function validateNodeData(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, NODE_DATA_FIELDS, [], path, itemIdentity, diagnostics);
  if (Object.keys(value).length === 0) {
    add(diagnostics, "spec.schema.minProperties", path, itemIdentity, "data must contain at least one property.",
      { expected: "at least 1 property", actual: 0 }, ["add"]);
  }
  for (const field of ["start", "end", "date"]) {
    if (value[field] !== undefined && !isIsoDate(value[field])) {
      add(diagnostics, "spec.schema.format", `${path}.${field}`, itemIdentity, `${field} must be a valid ISO date (YYYY-MM-DD).`,
        { expected: "YYYY-MM-DD", actual: value[field] }, ["replace"]);
    }
  }
  if (value.durationDays !== undefined) validateInteger(value.durationDays, `${path}.durationDays`, itemIdentity, diagnostics, 1, 365000);
  if (value.section !== undefined) validateText(value.section, `${path}.section`, itemIdentity, diagnostics, { min: 1, max: 200 });
  if (value.time !== undefined) validateText(value.time, `${path}.time`, itemIdentity, diagnostics, { min: 1, max: 200 });
}

function validateEdgeData(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, EDGE_DATA_FIELDS, [], path, itemIdentity, diagnostics);
  if (Object.keys(value).length === 0) {
    add(diagnostics, "spec.schema.minProperties", path, itemIdentity, "data must contain at least one property.",
      { expected: "at least 1 property", actual: 0 }, ["add"]);
  }
  if (value.relationship !== undefined) validateText(value.relationship, `${path}.relationship`, itemIdentity, diagnostics, { min: 1, max: 200 });
  for (const field of ["fromCardinality", "toCardinality"]) {
    if (value[field] !== undefined) validateEnum(value[field], CARDINALITIES, `${path}.${field}`, itemIdentity, diagnostics);
  }
}

function validateLayout(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, LAYOUT_FIELDS, [], path, itemIdentity, diagnostics);
  if (value.direction !== undefined) validateEnum(value.direction, new Set(["TB", "TD", "BT", "LR", "RL"]), `${path}.direction`, itemIdentity, diagnostics);
  for (const field of ["margin", "gapX", "gapY", "framePadding"]) {
    if (value[field] !== undefined) validateNumber(value[field], `${path}.${field}`, itemIdentity, diagnostics, 0, 10000);
  }
  for (const field of ["nodeWidth", "nodeHeight"]) {
    if (value[field] !== undefined) validateNumber(value[field], `${path}.${field}`, itemIdentity, diagnostics, Number.MIN_VALUE, 100000, true);
  }
  if (value.columns !== undefined) validateInteger(value.columns, `${path}.columns`, itemIdentity, diagnostics, 1, 1000);
  if (value.reflow !== undefined && typeof value.reflow !== "boolean") typeError(diagnostics, `${path}.reflow`, itemIdentity, "boolean", value.reflow);
}

function validateTheme(value, path, itemIdentity, diagnostics) {
  if (!expectObject(value, path, itemIdentity, diagnostics)) return;
  inspectFields(value, THEME_FIELDS, [], path, itemIdentity, diagnostics);
  for (const field of ["background", "text", "stroke", "primary", "secondary", "accent", "muted", "danger"]) {
    if (value[field] !== undefined) validatePattern(value[field], COLOR_PATTERN, `${path}.${field}`, itemIdentity, diagnostics, "a #RRGGBB color");
  }
  if (value.palette !== undefined) {
    if (!Array.isArray(value.palette)) {
      typeError(diagnostics, `${path}.palette`, itemIdentity, "array", value.palette);
    } else {
      if (value.palette.length < 1 || value.palette.length > 32) {
        add(diagnostics, "spec.schema.range", `${path}.palette`, itemIdentity, "palette must contain 1 to 32 colors.",
          { expected: { minItems: 1, maxItems: 32 }, actual: value.palette.length }, ["replace"]);
      }
      value.palette.forEach((color, index) => validatePattern(color, COLOR_PATTERN, `${path}.palette[${index}]`, itemIdentity, diagnostics, "a #RRGGBB color"));
    }
  }
}

function validateIdentitiesAndReferences(spec, diagnostics, rootIdentity) {
  const nodes = collectIds(spec.nodes, "node", "$.nodes", diagnostics);
  const edges = collectIds(spec.edges, "edge", "$.edges", diagnostics);
  const groups = collectIds(Array.isArray(spec.groups) ? spec.groups : [], "group", "$.groups", diagnostics);
  const lanes = collectIds(Array.isArray(spec.lanes) ? spec.lanes : [], "lane", "$.lanes", diagnostics);
  collectIds(Array.isArray(spec.annotations) ? spec.annotations : [], "annotation", "$.annotations", diagnostics);
  void edges;

  for (const [index, edge] of spec.edges.entries()) {
    if (!isObject(edge)) continue;
    const itemIdentity = identity("edge", typeof edge.id === "string" ? edge.id : String(index));
    for (const field of ["from", "to"]) {
      if (typeof edge[field] === "string" && ID_PATTERN.test(edge[field]) && !nodes.has(edge[field])) {
        add(diagnostics, "spec.schema.reference", `$.edges[${index}].${field}`, itemIdentity,
          `Edge ${field} references unknown node ${edge[field]}.`,
          { expected: "an existing node id", actual: edge[field] }, ["replace"]);
      }
    }
  }
  for (const [index, node] of spec.nodes.entries()) {
    if (!isObject(node)) continue;
    const itemIdentity = identity("node", typeof node.id === "string" ? node.id : String(index));
    if (typeof node.groupId === "string" && ID_PATTERN.test(node.groupId) && !groups.has(node.groupId)) {
      add(diagnostics, "spec.schema.reference", `$.nodes[${index}].groupId`, itemIdentity,
        `Node groupId references unknown group ${node.groupId}.`, { expected: "an existing group id", actual: node.groupId }, ["replace"]);
    }
    if (typeof node.laneId === "string" && ID_PATTERN.test(node.laneId) && !lanes.has(node.laneId)) {
      add(diagnostics, "spec.schema.reference", `$.nodes[${index}].laneId`, itemIdentity,
        `Node laneId references unknown lane ${node.laneId}.`, { expected: "an existing lane id", actual: node.laneId }, ["replace"]);
    }
  }

  if (spec.documentId === undefined) void rootIdentity;
}

function validateTypeSemantics(spec, diagnostics, rootIdentity) {
  if (!CHART_TYPES.has(spec.type)) return;
  const handlers = {
    mindmap: validateMindmap,
    swimlane: validateSwimlane,
    sequence: validateSequence,
    state: validateState,
    class: validateClass,
    er: validateEr,
    gantt: validateGantt,
    timeline: validateTimeline,
    dataflow: validateDataflow,
  };
  handlers[spec.type]?.(spec, diagnostics, rootIdentity);
}

function validateMindmap(spec, diagnostics, rootIdentity) {
  const validNodes = spec.nodes.filter((node) => isObject(node) && typeof node.id === "string");
  const nodeIds = new Set(validNodes.map((node) => node.id));
  const roots = validNodes.filter((node) => node.kind === "root");
  if (roots.length !== 1) {
    semanticError(diagnostics, "mindmap.root", "$.nodes", rootIdentity,
      "A mindmap must contain exactly one root node.", { expected: 1, actual: roots.length });
    return;
  }
  const validEdges = spec.edges.filter((edge) => isObject(edge) && nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const indegree = new Map(validNodes.map((node) => [node.id, 0]));
  for (const edge of validEdges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const root = roots[0];
  const wrongParent = validNodes.find((node) => node.id === root.id ? indegree.get(node.id) !== 0 : indegree.get(node.id) !== 1);
  const reached = new Set([root.id]);
  const queue = [root.id];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of validEdges.filter((candidate) => candidate.from === current)) {
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  if (validEdges.length !== validNodes.length - 1 || wrongParent || reached.size !== validNodes.length) {
    semanticError(diagnostics, "mindmap.tree", "$.edges", identity("node", root.id),
      "Mindmap edges must form one connected directed tree rooted at the root node.",
      { nodes: validNodes.length, edges: validEdges.length, reached: reached.size, invalidParent: wrongParent?.id ?? null });
  }
}

function validateSwimlane(spec, diagnostics, rootIdentity) {
  const lanes = Array.isArray(spec.lanes) ? spec.lanes : [];
  if (lanes.length === 0) {
    semanticError(diagnostics, "swimlane.lanes", "$.lanes", rootIdentity,
      "A swimlane diagram must define at least one lane.", { expected: "at least 1 lane", actual: lanes.length });
  }
  for (const [index, node] of spec.nodes.entries()) {
    if (isObject(node) && node.laneId === undefined) {
      semanticError(diagnostics, "swimlane.assignment", `$.nodes[${index}].laneId`, identity("node", node.id ?? String(index)),
        "Every swimlane node must be assigned to a lane.", { expected: "laneId", actual: null });
    }
  }
}

function validateSequence(spec, diagnostics, rootIdentity) {
  requireUniqueOrders(spec.nodes, "node", "$.nodes", diagnostics, rootIdentity);
  requireUniqueOrders(spec.edges, "edge", "$.edges", diagnostics, rootIdentity);
  for (const [index, edge] of spec.edges.entries()) {
    if (isObject(edge) && (typeof edge.label !== "string" || edge.label.length === 0)) {
      semanticError(diagnostics, "sequence.message", `$.edges[${index}].label`, identity("edge", edge.id ?? String(index)),
        "Every sequence edge must have a non-empty message label.", { expected: "non-empty string", actual: edge.label });
    }
  }
}

function validateState(spec, diagnostics, rootIdentity) {
  const starts = spec.nodes.filter((node) => isObject(node) && node.kind === "start");
  const ends = spec.nodes.filter((node) => isObject(node) && node.kind === "end");
  if (starts.length !== 1) {
    semanticError(diagnostics, "state.initial", "$.nodes", rootIdentity,
      "A state diagram must contain exactly one initial node.", { expected: 1, actual: starts.length });
  }
  if (ends.length < 1) {
    semanticError(diagnostics, "state.final", "$.nodes", rootIdentity,
      "A state diagram must contain at least one final node.", { expected: "at least 1", actual: ends.length });
  }
  if (starts.length === 1) {
    const incoming = spec.edges.filter((edge) => isObject(edge) && edge.to === starts[0].id);
    if (incoming.length > 0) semanticError(diagnostics, "state.initialIncoming", "$.edges", identity("node", starts[0].id),
      "The initial state must not have incoming transitions.", { actual: incoming.map((edge) => edge.id) });
  }
  const endIds = new Set(ends.map((node) => node.id));
  const outgoing = spec.edges.filter((edge) => isObject(edge) && endIds.has(edge.from));
  if (outgoing.length > 0) semanticError(diagnostics, "state.finalOutgoing", "$.edges", rootIdentity,
    "Final states must not have outgoing transitions.", { actual: outgoing.map((edge) => edge.id) });
}

function validateClass(spec, diagnostics, rootIdentity) {
  for (const [index, node] of spec.nodes.entries()) {
    if (isObject(node) && node.kind !== undefined && node.kind !== "class") {
      semanticError(diagnostics, "class.nodeKind", `$.nodes[${index}].kind`, identity("node", node.id ?? String(index)),
        "Class diagram nodes must use kind 'class'.", { expected: "class", actual: node.kind });
    }
  }
  for (const [index, edge] of spec.edges.entries()) {
    if (isObject(edge) && edge.kind !== undefined && !CLASS_RELATIONSHIPS.has(edge.kind)) {
      semanticError(diagnostics, "class.relationship", `$.edges[${index}].kind`, identity("edge", edge.id ?? String(index)),
        "Class diagram edges must use a class relationship kind.",
        { expected: [...CLASS_RELATIONSHIPS], actual: edge.kind });
    }
  }
  void rootIdentity;
}

function validateEr(spec, diagnostics, rootIdentity) {
  for (const [index, node] of spec.nodes.entries()) {
    if (isObject(node) && node.kind !== undefined && node.kind !== "entity") {
      semanticError(diagnostics, "er.nodeKind", `$.nodes[${index}].kind`, identity("node", node.id ?? String(index)),
        "ER diagram nodes must use kind 'entity'.", { expected: "entity", actual: node.kind });
    }
  }
  for (const [index, edge] of spec.edges.entries()) {
    if (!isObject(edge)) continue;
    const itemIdentity = identity("edge", edge.id ?? String(index));
    for (const field of ["fromCardinality", "toCardinality"]) {
      if (!isObject(edge.data) || !CARDINALITIES.has(edge.data[field])) {
        semanticError(diagnostics, "er.cardinality", `$.edges[${index}].data.${field}`, itemIdentity,
          `ER relationships require a canonical ${field}.`, { expected: [...CARDINALITIES], actual: edge.data?.[field] });
      }
    }
  }
  void rootIdentity;
}

function validateGantt(spec, diagnostics, rootIdentity) {
  if (spec.edges.length > 0) {
    semanticError(diagnostics, "gantt.edges", "$.edges", rootIdentity,
      "Gantt diagrams express tasks as nodes and must not contain edges.", { expected: 0, actual: spec.edges.length });
  }
  for (const [index, node] of spec.nodes.entries()) {
    if (!isObject(node)) continue;
    const itemIdentity = identity("node", node.id ?? String(index));
    if (!new Set(["task", "milestone"]).has(node.kind)) {
      semanticError(diagnostics, "gantt.nodeKind", `$.nodes[${index}].kind`, itemIdentity,
        "Gantt nodes must use kind 'task' or 'milestone'.", { expected: ["task", "milestone"], actual: node.kind });
    }
    const data = node.data;
    if (!isObject(data) || !isIsoDate(data.start)) {
      semanticError(diagnostics, "gantt.start", `$.nodes[${index}].data.start`, itemIdentity,
        "Every Gantt task must have a valid ISO start date.", { expected: "YYYY-MM-DD", actual: data?.start });
      continue;
    }
    const hasDuration = Number.isInteger(data.durationDays) && data.durationDays >= 1 && data.durationDays <= 365000;
    const hasEnd = isIsoDate(data.end);
    if (hasDuration === hasEnd) {
      semanticError(diagnostics, "gantt.finish", `$.nodes[${index}].data`, itemIdentity,
        "A Gantt task must define exactly one of durationDays or end.",
        { expected: "exactly one of durationDays or end", actual: { durationDays: data.durationDays, end: data.end } });
    } else if (hasEnd && data.end < data.start) {
      semanticError(diagnostics, "gantt.dateOrder", `$.nodes[${index}].data.end`, itemIdentity,
        "A Gantt end date must not be before its start date.", { start: data.start, end: data.end });
    }
    for (const field of ["time", "date"]) {
      if (data[field] !== undefined) semanticError(diagnostics, "gantt.data", `$.nodes[${index}].data.${field}`, itemIdentity,
        `Gantt node data does not allow ${field}.`, { actual: data[field] });
    }
  }
}

function validateTimeline(spec, diagnostics, rootIdentity) {
  if (spec.edges.length > 0) {
    semanticError(diagnostics, "timeline.edges", "$.edges", rootIdentity,
      "Timeline diagrams must not contain edges.", { expected: 0, actual: spec.edges.length });
  }
  for (const [index, node] of spec.nodes.entries()) {
    if (!isObject(node)) continue;
    const itemIdentity = identity("node", node.id ?? String(index));
    const data = node.data;
    const hasTime = isObject(data) && typeof data.time === "string" && data.time.length > 0;
    const hasDate = isObject(data) && isIsoDate(data.date);
    if (hasTime === hasDate) {
      semanticError(diagnostics, "timeline.time", `$.nodes[${index}].data`, itemIdentity,
        "A timeline event must define exactly one of time or date.",
        { expected: "exactly one of time or date", actual: isObject(data) ? { time: data.time, date: data.date } : data });
    }
    if (isObject(data)) {
      for (const field of ["start", "end", "durationDays", "section"]) {
        if (data[field] !== undefined) semanticError(diagnostics, "timeline.data", `$.nodes[${index}].data.${field}`, itemIdentity,
          `Timeline node data does not allow ${field}.`, { actual: data[field] });
      }
    }
  }
}

function validateDataflow(spec, diagnostics, rootIdentity) {
  for (const [index, node] of spec.nodes.entries()) {
    if (isObject(node) && node.kind !== undefined && !DATAFLOW_KINDS.has(node.kind)) {
      semanticError(diagnostics, "dataflow.nodeKind", `$.nodes[${index}].kind`, identity("node", node.id ?? String(index)),
        "Dataflow nodes must be processes, data stores, or external entities.",
        { expected: [...DATAFLOW_KINDS], actual: node.kind });
    }
  }
  for (const [index, edge] of spec.edges.entries()) {
    if (isObject(edge) && edge.kind !== undefined && edge.kind !== "flow") {
      semanticError(diagnostics, "dataflow.edgeKind", `$.edges[${index}].kind`, identity("edge", edge.id ?? String(index)),
        "Dataflow edges must use kind 'flow'.", { expected: "flow", actual: edge.kind });
    }
  }
  void rootIdentity;
}

function validateV1(spec, diagnostics, rootIdentity) {
  if (!expectObject(spec, "$", rootIdentity, diagnostics)) return;
  if (spec.schemaVersion !== undefined && spec.schemaVersion !== 0 && spec.schemaVersion !== 1) {
    valueError(diagnostics, "const", "$.schemaVersion", rootIdentity, 1, spec.schemaVersion);
  }
  if (spec.documentId !== undefined && (typeof spec.documentId !== "string" || spec.documentId.length === 0)) {
    typeError(diagnostics, "$.documentId", rootIdentity, "non-empty string", spec.documentId);
  }
  const chartType = spec.type ?? spec.chartType;
  if (chartType !== undefined && !CHART_TYPES.has(String(chartType).toLowerCase())) {
    valueError(diagnostics, "enum", spec.type === undefined ? "$.chartType" : "$.type", rootIdentity, [...CHART_TYPES], chartType);
  }
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    add(diagnostics, "spec.schema.v1.nodes", "$.nodes", rootIdentity, "v1 nodes must contain at least one node.",
      { expected: "non-empty array", actual: spec.nodes }, ["replace"]);
    return;
  }

  const nodeIds = new Set();
  for (const [index, node] of spec.nodes.entries()) {
    const itemIdentity = identity("node", isObject(node) && node.id != null ? String(node.id) : String(index));
    if (!expectObject(node, `$.nodes[${index}]`, itemIdentity, diagnostics)) continue;
    const id = String(node.id ?? `node-${index + 1}`);
    if (nodeIds.has(id)) duplicateError(diagnostics, `$.nodes[${index}].id`, itemIdentity, id);
    nodeIds.add(id);
    if (node.position !== undefined) {
      if (!isObject(node.position) || !isFiniteNumber(node.position.x) || !isFiniteNumber(node.position.y)) {
        add(diagnostics, "spec.schema.v1.position", `$.nodes[${index}].position`, itemIdentity,
          "v1 node position must contain finite x and y numbers.", { actual: node.position }, ["replace"]);
      }
    }
  }

  const edges = spec.edges ?? spec.connections ?? [];
  if (!Array.isArray(edges)) {
    typeError(diagnostics, spec.edges === undefined ? "$.connections" : "$.edges", rootIdentity, "array", edges);
    return;
  }
  const edgeIds = new Set();
  for (const [index, edge] of edges.entries()) {
    const itemIdentity = identity("edge", isObject(edge) && edge.id != null ? String(edge.id) : String(index));
    if (!expectObject(edge, `$.edges[${index}]`, itemIdentity, diagnostics)) continue;
    const id = String(edge.id ?? `edge-${index + 1}`);
    if (edgeIds.has(id)) duplicateError(diagnostics, `$.edges[${index}].id`, itemIdentity, id);
    edgeIds.add(id);
    for (const field of ["from", "to"]) {
      const reference = String(edge[field] ?? "");
      if (!nodeIds.has(reference)) {
        add(diagnostics, "spec.schema.reference", `$.edges[${index}].${field}`, itemIdentity,
          `Edge ${field} references unknown node ${reference}.`, { expected: "an existing node id", actual: reference }, ["replace"]);
      }
    }
  }

  validateV1Partitions(spec, "groups", "groupId", spec.nodes, diagnostics, rootIdentity);
  validateV1Partitions(spec, "lanes", "laneId", spec.nodes, diagnostics, rootIdentity);
  for (const field of ["annotations"]) {
    if (spec[field] !== undefined && !Array.isArray(spec[field])) typeError(diagnostics, `$.${field}`, rootIdentity, "array", spec[field]);
  }
  for (const field of ["layout", "theme"]) {
    if (spec[field] !== undefined && !isObject(spec[field])) typeError(diagnostics, `$.${field}`, rootIdentity, "object", spec[field]);
  }
}

function validateV1Partitions(spec, collectionName, referenceName, nodes, diagnostics, rootIdentity) {
  const collection = spec[collectionName] ?? [];
  if (!Array.isArray(collection)) {
    typeError(diagnostics, `$.${collectionName}`, rootIdentity, "array", collection);
    return;
  }
  const ids = new Set();
  for (const [index, item] of collection.entries()) {
    if (!isObject(item)) continue;
    const id = String(item.id);
    const itemIdentity = identity(collectionName === "groups" ? "group" : "lane", id);
    if (ids.has(id)) duplicateError(diagnostics, `$.${collectionName}[${index}].id`, itemIdentity, id);
    ids.add(id);
  }
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node) || !node[referenceName]) continue;
    if (!ids.has(String(node[referenceName]))) {
      add(diagnostics, "spec.schema.reference", `$.nodes[${index}].${referenceName}`, identity("node", String(node.id ?? index)),
        `Node ${referenceName} references unknown ${collectionName.slice(0, -1)} ${String(node[referenceName])}.`,
        { expected: `an existing ${collectionName.slice(0, -1)} id`, actual: node[referenceName] }, ["replace"]);
    }
  }
}

function validateCollection(value, name, validator, diagnostics, rootIdentity, options = {}) {
  if (value === undefined && options.optional) return;
  const path = `$.${name}`;
  if (!Array.isArray(value)) {
    if (value !== undefined) typeError(diagnostics, path, rootIdentity, "array", value);
    return;
  }
  if (options.minItems !== undefined && value.length < options.minItems) {
    add(diagnostics, "spec.schema.minItems", path, rootIdentity, `${name} must contain at least ${options.minItems} item.`,
      { expected: { minItems: options.minItems }, actual: value.length }, ["add"]);
  }
  const kind = name === "annotations" ? "annotation" : name.slice(0, -1);
  value.forEach((item, index) => validator(item, `${path}[${index}]`, identity(kind, isObject(item) && typeof item.id === "string" ? item.id : String(index)), diagnostics));
}

function collectIds(collection, kind, path, diagnostics) {
  const ids = new Set();
  for (const [index, item] of collection.entries()) {
    if (!isObject(item) || typeof item.id !== "string") continue;
    const itemIdentity = identity(kind, item.id);
    if (ids.has(item.id)) duplicateError(diagnostics, `${path}[${index}].id`, itemIdentity, item.id);
    ids.add(item.id);
  }
  return ids;
}

function requireUniqueOrders(collection, kind, path, diagnostics, rootIdentity) {
  const orders = new Set();
  for (const [index, item] of collection.entries()) {
    if (!isObject(item)) continue;
    const itemIdentity = identity(kind, item.id ?? String(index));
    if (!Number.isInteger(item.order)) {
      semanticError(diagnostics, "sequence.order", `${path}[${index}].order`, itemIdentity,
        `Every sequence ${kind} must have an integer order.`, { expected: "integer order", actual: item.order });
    } else if (orders.has(item.order)) {
      semanticError(diagnostics, "sequence.orderDuplicate", `${path}[${index}].order`, itemIdentity,
        `Sequence ${kind} order ${item.order} is duplicated.`, { actual: item.order });
    } else {
      orders.add(item.order);
    }
  }
  void rootIdentity;
}

function inspectFields(value, allowed, required, path, itemIdentity, diagnostics) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      add(diagnostics, "spec.schema.unknownField", propertyPath(path, key), itemIdentity,
        `Unknown field '${key}' is not allowed in DiagramSpec v2.`, { field: key, actual: value[key] }, ["remove"]);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      add(diagnostics, "spec.schema.required", propertyPath(path, key), itemIdentity,
        `Required field '${key}' is missing.`, { expected: key, actual: null }, ["add"]);
    }
  }
}

function expectObject(value, path, itemIdentity, diagnostics) {
  if (isObject(value)) return true;
  typeError(diagnostics, path, itemIdentity, "object", value);
  return false;
}

function validateId(value, path, itemIdentity, diagnostics) {
  validatePattern(value, ID_PATTERN, path, itemIdentity, diagnostics, "1-128 ASCII letters, digits, '.', '_', ':', or '-', starting with a letter or digit");
}

function validatePattern(value, pattern, path, itemIdentity, diagnostics, expected) {
  if (typeof value !== "string") {
    typeError(diagnostics, path, itemIdentity, "string", value);
  } else if (!pattern.test(value)) {
    add(diagnostics, "spec.schema.pattern", path, itemIdentity, `Value must be ${expected}.`, { expected, actual: value }, ["replace"]);
  }
}

function validateText(value, path, itemIdentity, diagnostics, { min, max }) {
  if (typeof value !== "string") {
    typeError(diagnostics, path, itemIdentity, "string", value);
  } else if (value.length < min || value.length > max) {
    add(diagnostics, "spec.schema.range", path, itemIdentity, `String length must be between ${min} and ${max}.`,
      { expected: { minLength: min, maxLength: max }, actual: value.length }, ["replace"]);
  }
}

function validateEnum(value, values, path, itemIdentity, diagnostics) {
  if (!values.has(value)) valueError(diagnostics, "enum", path, itemIdentity, [...values], value);
}

function validateInteger(value, path, itemIdentity, diagnostics, min, max) {
  if (!Number.isInteger(value)) {
    typeError(diagnostics, path, itemIdentity, "integer", value);
  } else if (value < min || value > max) {
    rangeError(diagnostics, path, itemIdentity, min, max, value);
  }
}

function validateNumber(value, path, itemIdentity, diagnostics, min, max, exclusiveMinimum = false) {
  if (!isFiniteNumber(value)) {
    typeError(diagnostics, path, itemIdentity, "finite number", value);
  } else if ((exclusiveMinimum ? value <= 0 : value < min) || value > max) {
    rangeError(diagnostics, path, itemIdentity, exclusiveMinimum ? "> 0" : min, max, value);
  }
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function identity(kind, id) {
  return { kind, id: id == null ? null : String(id) };
}

function propertyPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function typeError(diagnostics, path, itemIdentity, expected, actual) {
  add(diagnostics, "spec.schema.type", path, itemIdentity, `Value must be ${expected}.`, { expected, actual }, ["replace"]);
}

function valueError(diagnostics, rule, path, itemIdentity, expected, actual) {
  add(diagnostics, `spec.schema.${rule}`, path, itemIdentity, `Value is not allowed at ${path}.`, { expected, actual }, ["replace"]);
}

function rangeError(diagnostics, path, itemIdentity, min, max, actual) {
  add(diagnostics, "spec.schema.range", path, itemIdentity, `Value must be between ${String(min)} and ${String(max)}.`,
    { expected: { minimum: min, maximum: max }, actual }, ["replace"]);
}

function duplicateError(diagnostics, path, itemIdentity, id) {
  add(diagnostics, "spec.schema.duplicateId", path, itemIdentity, `Duplicate ${itemIdentity.kind} id '${id}'.`,
    { expected: "unique id", actual: id }, ["replace"]);
}

function semanticError(diagnostics, suffix, path, itemIdentity, message, evidence) {
  add(diagnostics, `spec.semantic.${suffix}`, path, itemIdentity, message, evidence, ["replace"]);
}

function add(diagnostics, code, path, itemIdentity, message, evidence, supportedFixes) {
  diagnostics.push({
    code,
    severity: "error",
    message,
    subject: { path, identity: itemIdentity },
    evidence,
    supportedFixes,
  });
}
