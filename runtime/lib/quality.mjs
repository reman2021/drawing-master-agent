import { DEFAULT_FONT_SIZES, isFiniteNumber, round } from "./core.mjs";
import { qualityReport } from "./diagnostics.mjs";
import { measureText } from "./text.mjs";

export function validateDocument(document, options = {}) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== "object") {
    return qualityReport([{ code: "document.invalid", message: "Document must be an object." }], [], options);
  }
  if (document.type !== "excalidraw") push(errors, "document.type", "Top-level type must be excalidraw.");
  if (document.version !== 2) push(errors, "document.version", "Top-level version must be 2.");
  validateMetadata(document.drawingMaster, errors, options.requireMetadata === true);
  if (!Array.isArray(document.elements)) {
    push(errors, "document.elements", "elements must be an array.");
    return qualityReport(errors, warnings, options);
  }

  const ids = new Set();
  const byId = new Map();
  for (const element of document.elements) {
    if (!element?.id || typeof element.id !== "string") {
      push(errors, "element.id", "Every element must have a string id.");
      continue;
    }
    if (ids.has(element.id)) push(errors, "element.duplicateId", `Duplicate element id: ${element.id}`, element.id);
    ids.add(element.id);
    byId.set(element.id, element);
    validateGeometry(element, errors);
  }

  for (const element of document.elements) validateReferences(element, byId, errors, warnings);
  validateFrames(document.elements, byId, errors);
  validateNodeOverlaps(document.elements, warnings);
  validateTextCapacity(document.elements, byId, warnings);
  validateEdgeIntersections(document.elements, byId, warnings);
  validateLargeDiagram(document.elements, warnings);
  return qualityReport(errors, warnings, options);
}

function validateMetadata(metadata, errors, required) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    if (required) push(errors, "metadata.missing", "drawingMaster metadata is required.");
    return;
  }
  for (const field of ["documentId", "specHash", "runtimeVersion", "schemaVersion"]) {
    if (required && (metadata[field] == null || metadata[field] === "")) {
      push(errors, "metadata.field", `drawingMaster metadata field ${field} is required.`);
    }
  }
  if (metadata.specHash && !/^[0-9a-f]{64}$/u.test(String(metadata.specHash))) {
    push(errors, "metadata.specHash", "drawingMaster specHash must be a SHA-256 hex digest.");
  }
}

function validateGeometry(element, errors) {
  for (const field of ["x", "y", "width", "height"]) {
    if (!isFiniteNumber(element[field])) {
      push(errors, "element.geometry", `${element.id}.${field} must be a finite number.`, element.id);
    }
  }
  if (isFiniteNumber(element.width) && element.width < 0) {
    push(errors, "element.width", `${element.id}.width must not be negative.`, element.id);
  }
  if (isFiniteNumber(element.height) && element.height < 0) {
    push(errors, "element.height", `${element.id}.height must not be negative.`, element.id);
  }
  if (["arrow", "line"].includes(element.type)) {
    if (!Array.isArray(element.points) || element.points.length < 2) {
      push(errors, "linear.points", `${element.id} must contain at least two points.`, element.id);
    } else if (element.points.some((point) => !Array.isArray(point) || point.some((value) => !isFiniteNumber(value)))) {
      push(errors, "linear.points", `${element.id} contains an invalid point.`, element.id);
    }
  }
}

function validateReferences(element, byId, errors, warnings) {
  for (const binding of element.boundElements ?? []) {
    if (!byId.has(binding.id)) {
      push(errors, "binding.missing", `${element.id} references missing bound element ${binding.id}.`, element.id);
    }
  }
  if (element.containerId && !byId.has(element.containerId)) {
    push(errors, "container.missing", `${element.id} references missing container ${element.containerId}.`, element.id);
  }
  if (element.frameId && !byId.has(element.frameId)) {
    push(errors, "frame.missing", `${element.id} references missing frame ${element.frameId}.`, element.id);
  }
  for (const key of ["startBinding", "endBinding"]) {
    const binding = element[key];
    if (!binding) continue;
    if (!byId.has(binding.elementId)) {
      push(errors, "arrow.bindingMissing", `${element.id}.${key} references ${binding.elementId}.`, element.id);
    }
    if (!Array.isArray(binding.fixedPoint) || binding.fixedPoint.length !== 2) {
      push(errors, "arrow.fixedPoint", `${element.id}.${key} must include a two-value fixedPoint.`, element.id);
    }
    if (!["orbit", "inside", "skip"].includes(binding.mode)) {
      push(errors, "arrow.bindingMode", `${element.id}.${key} has invalid mode ${binding.mode}.`, element.id);
    }
  }
  if (element.type === "arrow" && element.customData?.drawingMaster?.kind === "edge") {
    const chartType = element.customData.drawingMaster.chartType;
    if (chartType !== "sequence" && (!element.startBinding || !element.endBinding)) {
      push(errors, "arrow.unbound", `${element.id} must bind both endpoints.`, element.id);
    }
    if (chartType === "sequence" && (element.startBinding || element.endBinding)) {
      push(warnings, "sequence.binding", `${element.id} sequence message is unexpectedly bound.`, element.id);
    }
  }
}

function validateFrames(elements, byId, errors) {
  const framePositions = new Map(elements.map((element, index) => [element.id, index]));
  for (const element of elements) {
    if (!element.frameId) continue;
    const frame = byId.get(element.frameId);
    if (frame?.type !== "frame") {
      push(errors, "frame.type", `${element.frameId} must be a frame.`, element.id);
    }
    if ((framePositions.get(element.id) ?? 0) > (framePositions.get(element.frameId) ?? 0)) {
      push(errors, "frame.order", `Frame ${element.frameId} must appear after child ${element.id}.`, element.id);
    }
  }
}

function validateNodeOverlaps(elements, warnings) {
  const nodes = elements.filter((element) => element.customData?.drawingMaster?.kind === "node");
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const area = overlapArea(nodes[i], nodes[j]);
      const smaller = Math.min(nodes[i].width * nodes[i].height, nodes[j].width * nodes[j].height);
      if (smaller > 0 && area / smaller > 0.08) {
        push(
          warnings,
          "visual.nodeOverlap",
          `${nodes[i].id} overlaps ${nodes[j].id} by ${round((area / smaller) * 100)}%.`,
          nodes[i].id,
        );
      }
    }
  }
}

function validateTextCapacity(elements, byId, warnings) {
  for (const text of elements.filter((element) => element.type === "text" && element.containerId)) {
    const container = byId.get(text.containerId);
    if (!container || container.type === "arrow") continue;
    const measured = measureText(
      text.originalText ?? text.text ?? "",
      text.fontSize ?? DEFAULT_FONT_SIZES.node,
      Math.max(40, container.width - 28),
    );
    if (measured.width > container.width - 16 || measured.height > container.height - 12) {
      push(warnings, "visual.textOverflow", `${text.id} may overflow ${container.id}.`, text.id);
    }
  }
}

function validateEdgeIntersections(elements, byId, warnings) {
  const nodes = elements.filter((element) => element.customData?.drawingMaster?.kind === "node");
  const edges = elements.filter((element) => element.type === "arrow" && Array.isArray(element.points));
  for (const edge of edges) {
    const excluded = new Set([edge.startBinding?.elementId, edge.endBinding?.elementId].filter(Boolean));
    for (const node of nodes) {
      if (excluded.has(node.id)) continue;
      if (polylineIntersectsBox(edge, node)) {
        push(warnings, "visual.edgeThroughNode", `${edge.id} crosses node ${node.id}.`, edge.id);
      }
    }
  }

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      if (shareEndpoint(edges[i], edges[j])) continue;
      if (polylinesCross(edges[i], edges[j])) {
        push(warnings, "visual.edgeCrossing", `${edges[i].id} crosses ${edges[j].id}.`, edges[i].id);
      }
    }
  }
}

function validateLargeDiagram(elements, warnings) {
  const nodes = elements.filter((element) => element.customData?.drawingMaster?.kind === "node");
  if (nodes.length <= 30) return;
  const framed = nodes.filter((element) => element.frameId).length;
  if (framed < nodes.length) {
    push(warnings, "visual.largeUnframed", `${nodes.length - framed} of ${nodes.length} nodes are not split into frames.`);
  }
}

function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function polylineIntersectsBox(line, box) {
  const points = line.points.map(([x, y]) => ({ x: line.x + x, y: line.y + y }));
  for (let index = 0; index < points.length - 1; index += 1) {
    if (segmentIntersectsBox(points[index], points[index + 1], box)) return true;
  }
  return false;
}

function segmentIntersectsBox(a, b, box) {
  const edges = [
    [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }],
    [{ x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }],
    [{ x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }],
    [{ x: box.x, y: box.y + box.height }, { x: box.x, y: box.y }],
  ];
  return edges.some(([c, d]) => segmentsCross(a, b, c, d));
}

function polylinesCross(a, b) {
  const aPoints = a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }));
  const bPoints = b.points.map(([x, y]) => ({ x: b.x + x, y: b.y + y }));
  for (let i = 0; i < aPoints.length - 1; i += 1) {
    for (let j = 0; j < bPoints.length - 1; j += 1) {
      if (segmentsCross(aPoints[i], aPoints[i + 1], bPoints[j], bPoints[j + 1])) return true;
    }
  }
  return false;
}

function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function shareEndpoint(a, b) {
  const aEndpoints = new Set([a.startBinding?.elementId, a.endBinding?.elementId].filter(Boolean));
  return [b.startBinding?.elementId, b.endBinding?.elementId].some((id) => id && aEndpoints.has(id));
}

function push(target, code, message, elementId = null) {
  target.push({ code, message, ...(elementId ? { elementId } : {}) });
}
