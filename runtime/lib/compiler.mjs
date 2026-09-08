import {
  commonElement,
  DEFAULT_FONT_SIZES,
  normalizeSpec,
  round,
  stableId,
  stableSeed,
  DEFAULT_THEME,
  RUNTIME_VERSION,
} from "./core.mjs";
import { hashSpec } from "./formats.mjs";
import { layoutDiagram, nodeCenter } from "./layout.mjs";
import { measureText } from "./text.mjs";

const VISUAL_FIELDS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "angle",
  "link",
  "locked",
];

const POSITION_FIELDS = ["x", "y", "width", "height"];

export function compileSpec(input, options = {}) {
  const spec = normalizeSpec(input);
  const specHash = hashSpec(spec);
  const existingDocument = options.existingDocument ?? null;
  const existingIndex = indexExisting(existingDocument, spec);
  const existingPositions = new Map();
  for (const node of spec.nodes) {
    const existing = existingIndex.nodes.get(node.id);
    if (existing) {
      existingPositions.set(node.id, {
        x: existing.x,
        y: existing.y,
        width: existing.width,
        height: existing.height,
      });
    }
  }

  const layout = layoutDiagram(spec, { existingPositions });
  const frameIds = new Map(
    layout.frames.map((frame) => [
      frame.semanticId,
      existingIndex.frames.get(frame.semanticId)?.id ?? stableId("frame", spec.documentId, frame.semanticId),
    ]),
  );
  const nodeElementIds = new Map();
  const elements = [];
  const shapeElements = new Map();

  for (const nodeSpec of spec.nodes) {
    const node = layout.nodes.get(nodeSpec.id);
    const existingShape = existingIndex.nodes.get(nodeSpec.id);
    const shape = makeShape(spec, nodeSpec, node, frameIds, existingShape);
    const existingText = existingShape ? findBoundText(existingDocument, existingShape) : null;
    const text = makeBoundText(spec, nodeSpec, node, shape, existingText);
    shape.boundElements.push({ type: "text", id: text.id });
    elements.push(shape, text);
    shapeElements.set(nodeSpec.id, shape);
    nodeElementIds.set(nodeSpec.id, shape.id);
  }

  const decorations = makeDecorations(spec, layout, frameIds);
  elements.push(...decorations);

  for (const [edgeIndex, edgeSpec] of spec.edges.entries()) {
    const from = layout.nodes.get(edgeSpec.from);
    const to = layout.nodes.get(edgeSpec.to);
    const route = layout.routes.get(edgeSpec.id);
    const existingEdge = existingIndex.edges.get(edgeSpec.id);
    const edge = spec.type === "sequence"
      ? makeSequenceArrow(spec, edgeSpec, edgeIndex, from, to, existingEdge)
      : makeArrow(spec, edgeSpec, from, to, route, nodeElementIds, frameIds, existingEdge);
    elements.push(edge);

    if (edge.startBinding) {
      shapeElements.get(edgeSpec.from)?.boundElements.push({ type: "arrow", id: edge.id });
    }
    if (edge.endBinding) {
      shapeElements.get(edgeSpec.to)?.boundElements.push({ type: "arrow", id: edge.id });
    }
    if (edgeSpec.label) {
      const existingLabel = existingEdge ? findBoundText(existingDocument, existingEdge) : null;
      const label = makeArrowLabel(spec, edgeSpec, edge, existingLabel, spec.type === "sequence" ? null : route);
      edge.boundElements = [...(edge.boundElements ?? []), { type: "text", id: label.id }];
      elements.push(label);
    }
  }

  for (const annotation of spec.annotations) {
    elements.push(makeAnnotation(spec, annotation));
  }

  for (const frame of layout.frames) {
    elements.push(makeFrame(spec, frame, frameIds, existingIndex.frames.get(frame.semanticId)));
  }

  const merged = mergeUnknownElements(existingDocument, spec, elements);
  repairPreservedBindings(merged, existingDocument);
  const document = {
    ...(existingDocument && typeof existingDocument === "object" ? existingDocument : {}),
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: merged,
    appState: {
      ...(existingDocument?.appState ?? {}),
      viewBackgroundColor: spec.theme.background ?? DEFAULT_THEME.background,
      gridSize: existingDocument?.appState?.gridSize ?? null,
    },
    files: existingDocument?.files ?? {},
    drawingMaster: {
      documentId: spec.documentId,
      schemaVersion: spec.schemaVersion,
      runtimeVersion: RUNTIME_VERSION,
      specHash,
      chartType: spec.type,
    },
  };
  return { document, spec, layout };
}

function makeShape(spec, nodeSpec, node, frameIds, existing) {
  const id = existing?.id ?? nodeSpec.existingElementId ?? stableId("node", spec.documentId, nodeSpec.id);
  const frameId = node.frameSemanticId ? frameIds.get(node.frameSemanticId) ?? null : null;
  const shape = commonElement({
    id,
    type: node.shape,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    documentId: spec.documentId,
    semanticKind: "node",
    semanticId: nodeSpec.id,
    frameId,
    schemaVersion: spec.schemaVersion,
  });
  shape.backgroundColor = nodeSpec.style?.backgroundColor
    ?? spec.theme.palette[Math.abs(stableSeed(nodeSpec.id)) % spec.theme.palette.length]
    ?? spec.theme.primary;
  shape.strokeColor = nodeSpec.style?.strokeColor ?? spec.theme.stroke;
  if (node.shape === "ellipse") shape.roundness = { type: 2 };
  if (node.shape === "diamond") shape.roundness = { type: 2 };
  return preserveElement(shape, existing, nodeSpec, spec.layout.reflow === true);
}

function makeBoundText(spec, nodeSpec, node, shape, existing) {
  const fontSize = Number(nodeSpec.style?.fontSize ?? existing?.fontSize ?? DEFAULT_FONT_SIZES.node);
  const measured = measureText(nodeSpec.label, fontSize, Math.max(40, shape.width - 28));
  const text = commonElement({
    id: existing?.id ?? stableId("label", spec.documentId, nodeSpec.id),
    type: "text",
    x: shape.x + (shape.width - measured.width) / 2,
    y: shape.y + (shape.height - measured.height) / 2,
    width: measured.width,
    height: measured.height,
    documentId: spec.documentId,
    semanticKind: "node-label",
    semanticId: nodeSpec.id,
    frameId: shape.frameId,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(text, {
    strokeColor: nodeSpec.style?.textColor ?? existing?.strokeColor ?? spec.theme.text,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    text: measured.text,
    originalText: nodeSpec.label,
    fontSize,
    fontFamily: Number(nodeSpec.style?.fontFamily ?? existing?.fontFamily ?? 5),
    textAlign: "center",
    verticalAlign: "middle",
    containerId: shape.id,
    autoResize: true,
    lineHeight: measured.lineHeight,
    baseline: round(fontSize),
  });
  return preserveTextStyle(text, existing, nodeSpec.style);
}

function makeArrow(spec, edgeSpec, from, to, geometry, nodeElementIds, frameIds, existing) {
  const sameFrame = from.frameSemanticId && from.frameSemanticId === to.frameSemanticId
    ? frameIds.get(from.frameSemanticId) ?? null
    : null;
  const arrow = commonElement({
    id: existing?.id ?? edgeSpec.existingElementId ?? stableId("edge", spec.documentId, edgeSpec.id),
    type: "arrow",
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    documentId: spec.documentId,
    semanticKind: "edge",
    semanticId: edgeSpec.id,
    frameId: sameFrame,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(arrow, {
    strokeColor: edgeSpec.style?.strokeColor ?? spec.theme.stroke,
    backgroundColor: "transparent",
    roundness: { type: 2 },
    points: geometry.points,
    lastCommittedPoint: null,
    startBinding: {
      elementId: nodeElementIds.get(edgeSpec.from),
      fixedPoint: geometry.startFixedPoint,
      mode: "orbit",
    },
    endBinding: {
      elementId: nodeElementIds.get(edgeSpec.to),
      fixedPoint: geometry.endFixedPoint,
      mode: "orbit",
    },
    startArrowhead: arrowhead(edgeSpec.startArrowhead, edgeSpec.kind, true),
    endArrowhead: arrowhead(edgeSpec.endArrowhead, edgeSpec.kind, false),
    elbowed: false,
  });
  arrow.customData.drawingMaster.chartType = spec.type;
  return preserveElement(arrow, existing, edgeSpec, false);
}

function makeSequenceArrow(spec, edgeSpec, index, from, to, existing) {
  const fromCenter = nodeCenter(from);
  const toCenter = nodeCenter(to);
  const y = Math.max(from.y + from.height, to.y + to.height) + 90 + index * 86;
  const arrow = commonElement({
    id: existing?.id ?? edgeSpec.existingElementId ?? stableId("edge", spec.documentId, edgeSpec.id),
    type: "arrow",
    x: fromCenter.x,
    y,
    width: Math.abs(toCenter.x - fromCenter.x),
    height: 0,
    documentId: spec.documentId,
    semanticKind: "edge",
    semanticId: edgeSpec.id,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(arrow, {
    strokeColor: edgeSpec.style?.strokeColor ?? spec.theme.stroke,
    backgroundColor: "transparent",
    roundness: null,
    points: [[0, 0], [round(toCenter.x - fromCenter.x), 0]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: edgeSpec.kind === "return" ? "arrow" : "arrow",
    elbowed: false,
  });
  arrow.customData.drawingMaster.chartType = spec.type;
  return preserveElement(arrow, existing, edgeSpec, false);
}

function makeArrowLabel(spec, edgeSpec, arrow, existing, route) {
  const fontSize = Number(edgeSpec.style?.fontSize ?? existing?.fontSize ?? DEFAULT_FONT_SIZES.edge);
  const measured = measureText(edgeSpec.label, fontSize, Math.max(100, arrow.width - 20));
  const point = route?.labelPoint ?? {
    x: arrow.x + arrow.points.at(-1)[0] / 2,
    y: arrow.y + arrow.points.at(-1)[1] / 2,
  };
  const x = route?.labelBounds?.x ?? point.x - measured.width / 2;
  const y = route?.labelBounds?.y ?? point.y - measured.height / 2 - 8;
  const text = commonElement({
    id: existing?.id ?? stableId("edge-label", spec.documentId, edgeSpec.id),
    type: "text",
    x,
    y,
    width: measured.width,
    height: measured.height,
    documentId: spec.documentId,
    semanticKind: "edge-label",
    semanticId: edgeSpec.id,
    frameId: arrow.frameId,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(text, {
    strokeColor: edgeSpec.style?.textColor ?? existing?.strokeColor ?? spec.theme.text,
    backgroundColor: spec.theme.background,
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    text: measured.text,
    originalText: edgeSpec.label,
    fontSize,
    fontFamily: Number(edgeSpec.style?.fontFamily ?? existing?.fontFamily ?? 5),
    textAlign: "center",
    verticalAlign: "middle",
    containerId: arrow.id,
    autoResize: true,
    lineHeight: measured.lineHeight,
    baseline: round(fontSize),
  });
  return preserveTextStyle(text, existing, edgeSpec.style);
}

function makeDecorations(spec, layout, frameIds) {
  if (spec.type === "sequence") {
    const bottom = layout.settings.margin + 170 + Math.max(1, spec.edges.length) * 86;
    return [...layout.nodes.values()].map((node) => {
      const center = nodeCenter(node);
      return makeLine(spec, `lifeline:${node.id}`, center.x, node.y + node.height, 0, bottom - node.y - node.height, {
        strokeStyle: "dashed",
        strokeColor: spec.theme.stroke,
      });
    });
  }
  if (spec.type === "timeline") {
    const values = [...layout.nodes.values()];
    const minX = Math.min(...values.map((node) => node.x));
    const maxX = Math.max(...values.map((node) => node.x + node.width));
    const y = layout.settings.margin + 175;
    return [makeLine(spec, "timeline-axis", minX, y, maxX - minX, 0, { strokeWidth: 3 })];
  }
  if (spec.type === "fishbone") {
    const values = [...layout.nodes.values()];
    const minX = Math.min(...values.map((node) => node.x));
    const maxX = Math.max(...values.map((node) => node.x + node.width));
    return [makeLine(spec, "fishbone-spine", minX, layout.settings.margin + 195, maxX - minX, 0, { strokeWidth: 4 })];
  }
  return [];
}

function makeLine(spec, semanticId, x, y, dx, dy, style = {}) {
  const line = commonElement({
    id: stableId("line", spec.documentId, semanticId),
    type: "line",
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    documentId: spec.documentId,
    semanticKind: "decoration",
    semanticId,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(line, {
    ...style,
    backgroundColor: "transparent",
    roundness: null,
    points: [[0, 0], [round(dx), round(dy)]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  });
  return line;
}

function makeAnnotation(spec, annotation) {
  const fontSize = Number(annotation.style?.fontSize ?? DEFAULT_FONT_SIZES.annotation);
  const measured = measureText(annotation.text ?? "", fontSize, 420);
  const text = commonElement({
    id: stableId("annotation", spec.documentId, annotation.id),
    type: "text",
    x: Number(annotation.position?.x ?? 80),
    y: Number(annotation.position?.y ?? 40),
    width: measured.width,
    height: measured.height,
    documentId: spec.documentId,
    semanticKind: "annotation",
    semanticId: annotation.id,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(text, {
    strokeColor: annotation.style?.textColor ?? spec.theme.text,
    backgroundColor: "transparent",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    text: measured.text,
    originalText: annotation.text ?? "",
    fontSize,
    fontFamily: Number(annotation.style?.fontFamily ?? 5),
    textAlign: annotation.style?.textAlign ?? "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: measured.lineHeight,
    baseline: round(fontSize),
  });
  return text;
}

function makeFrame(spec, frame, frameIds, existing) {
  const element = commonElement({
    id: frameIds.get(frame.semanticId),
    type: "frame",
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    documentId: spec.documentId,
    semanticKind: "frame",
    semanticId: frame.semanticId,
    schemaVersion: spec.schemaVersion,
  });
  Object.assign(element, {
    name: frame.label ?? null,
    backgroundColor: "transparent",
    strokeColor: spec.theme.stroke,
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: 0,
    roundness: { type: 3 },
  });
  return preserveElement(element, existing, {}, true);
}

function arrowhead(explicit, kind, start) {
  if (explicit !== undefined) return explicit;
  if (start) return kind === "bidirectional" ? "arrow" : null;
  if (kind === "association") return null;
  if (kind === "inheritance") return "triangle_outline";
  if (kind === "aggregation") return "diamond_outline";
  if (kind === "composition") return "diamond";
  return "arrow";
}

function preserveElement(generated, existing, specEntry, preservePosition) {
  if (!existing) return generated;
  const merged = { ...existing, ...generated };
  for (const field of VISUAL_FIELDS) {
    if (existing[field] !== undefined && specEntry.style?.[field] === undefined) merged[field] = existing[field];
  }
  if (preservePosition && !specEntry.position) {
    for (const field of POSITION_FIELDS) {
      if (Number.isFinite(existing[field])) merged[field] = existing[field];
    }
    if (Array.isArray(existing.points)) merged.points = existing.points;
  }
  merged.customData = {
    ...(existing.customData ?? {}),
    ...(generated.customData ?? {}),
    drawingMaster: generated.customData.drawingMaster,
  };
  return merged;
}

function preserveTextStyle(generated, existing, explicitStyle = {}) {
  if (!existing) return generated;
  for (const field of ["fontSize", "fontFamily", "strokeColor", "opacity"]) {
    if (existing[field] !== undefined && explicitStyle?.[field] === undefined) generated[field] = existing[field];
  }
  return generated;
}

function indexExisting(document, spec) {
  const nodes = new Map();
  const edges = new Map();
  const frames = new Map();
  const byId = new Map((document?.elements ?? []).map((element) => [element.id, element]));
  for (const element of document?.elements ?? []) {
    const metadata = element.customData?.drawingMaster;
    if (metadata?.documentId === spec.documentId) {
      if (metadata.kind === "node") nodes.set(metadata.semanticId, element);
      if (metadata.kind === "edge") edges.set(metadata.semanticId, element);
      if (metadata.kind === "frame") frames.set(metadata.semanticId, element);
    }
  }
  for (const node of spec.nodes) {
    if (!nodes.has(node.id) && node.existingElementId && byId.has(node.existingElementId)) {
      nodes.set(node.id, byId.get(node.existingElementId));
    }
  }
  for (const edge of spec.edges) {
    if (!edges.has(edge.id) && edge.existingElementId && byId.has(edge.existingElementId)) {
      edges.set(edge.id, byId.get(edge.existingElementId));
    }
  }
  return { nodes, edges, frames };
}

function findBoundText(document, container) {
  if (!document || !container) return null;
  const textId = container.boundElements?.find((item) => item.type === "text")?.id;
  return document.elements.find(
    (element) => element.type === "text" && (element.id === textId || element.containerId === container.id),
  ) ?? null;
}

function mergeUnknownElements(existingDocument, spec, generated) {
  if (!existingDocument) return generated;
  const replacedIds = new Set(generated.map((element) => element.id));
  const retained = existingDocument.elements.filter((element) => {
    if (replacedIds.has(element.id)) return false;
    const metadata = element.customData?.drawingMaster;
    return metadata?.documentId !== spec.documentId;
  });
  return [...retained, ...generated];
}

function repairPreservedBindings(elements, existingDocument) {
  if (!existingDocument) return;
  const finalIds = new Set(elements.map((element) => element.id));
  const existingById = new Map(existingDocument.elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (!["rectangle", "ellipse", "diamond"].includes(element.type)) continue;
    const old = existingById.get(element.id);
    const extra = (old?.boundElements ?? []).filter(
      (binding) => finalIds.has(binding.id) && !(element.boundElements ?? []).some((item) => item.id === binding.id),
    );
    element.boundElements = [...(element.boundElements ?? []), ...extra];
  }
}
