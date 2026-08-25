import { round } from "./core.mjs";
import { measureText } from "./text.mjs";

const DEFAULTS = Object.freeze({
  margin: 120,
  gapX: 180,
  gapY: 120,
  nodeWidth: 200,
  nodeHeight: 88,
  framePadding: 64,
});

export function layoutDiagram(spec, options = {}) {
  const settings = { ...DEFAULTS, ...spec.layout };
  const nodes = new Map(spec.nodes.map((node) => [node.id, sizedNode(node, spec.type, settings)]));
  const existing = options.existingPositions ?? new Map();

  const strategies = {
    mindmap: radialLayout,
    network: radialLayout,
    concept: radialLayout,
    sequence: sequenceLayout,
    swimlane: swimlaneLayout,
    gantt: ganttLayout,
    timeline: timelineLayout,
    fishbone: fishboneLayout,
    swot: matrixLayout,
    matrix: matrixLayout,
    pyramid: stackLayout,
    funnel: stackLayout,
    venn: vennLayout,
    infographic: gridLayout,
    er: graphGridLayout,
    class: graphGridLayout,
    architecture: layeredLayout,
    flowchart: layeredLayout,
    state: layeredLayout,
    dataflow: layeredLayout,
    tree: layeredLayout,
    orgchart: layeredLayout,
  };

  (strategies[spec.type] ?? gridLayout)(spec, nodes, settings);
  applyStablePositions(spec, nodes, existing);
  settleNewNodes(nodes, existing, settings);
  const frames = buildFrames(spec, nodes, settings);
  assignFrames(nodes, frames);
  return { nodes, frames, settings };
}

function sizedNode(node, chartType, settings) {
  const fontSize = Number(node.style?.fontSize ?? 20);
  const text = measureText(node.label, fontSize, 280);
  const baseWidth = chartType === "class" || chartType === "er" ? 230 : settings.nodeWidth;
  const baseHeight = chartType === "class" || chartType === "er" ? 112 : settings.nodeHeight;
  const width = Number(node.size?.width ?? Math.max(baseWidth, Math.min(320, text.width + 52)));
  const height = Number(node.size?.height ?? Math.max(baseHeight, text.height + 36));
  return {
    ...node,
    x: 0,
    y: 0,
    width,
    height,
    shape: inferShape(node, chartType),
    frameSemanticId: null,
  };
}

function inferShape(node, chartType) {
  if (["rectangle", "ellipse", "diamond"].includes(node.shape)) return node.shape;
  if (chartType === "venn") return "ellipse";
  if (["start", "end", "actor", "root", "concept", "attribute"].includes(node.kind)) return "ellipse";
  if (["decision", "relation"].includes(node.kind)) return "diamond";
  return "rectangle";
}

function layeredLayout(spec, nodes, settings) {
  const ranks = calculateRanks(spec);
  const byRank = new Map();
  for (const node of spec.nodes) {
    const rank = node.level ?? ranks.get(node.id) ?? 0;
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(nodes.get(node.id));
  }

  const direction = String(spec.layout.direction ?? "TB").toUpperCase();
  for (const [rank, rankNodes] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    rankNodes.sort((a, b) => a.id.localeCompare(b.id));
    rankNodes.forEach((node, index) => {
      if (direction === "LR") {
        node.x = settings.margin + rank * (settings.nodeWidth + settings.gapX);
        node.y = settings.margin + index * (settings.nodeHeight + settings.gapY);
      } else {
        node.x = settings.margin + index * (settings.nodeWidth + settings.gapX);
        node.y = settings.margin + rank * (settings.nodeHeight + settings.gapY);
      }
    });
  }
}

function graphGridLayout(spec, nodes, settings) {
  const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.size)));
  [...nodes.values()]
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.id.localeCompare(b.id))
    .forEach((node, index) => {
      node.x = settings.margin + (index % columns) * (260 + settings.gapX);
      node.y = settings.margin + Math.floor(index / columns) * (130 + settings.gapY);
    });
}

function radialLayout(spec, nodes, settings) {
  const rootId = findRoot(spec);
  const levels = breadthLevels(spec, rootId);
  const centerX = settings.margin + 700;
  const centerY = settings.margin + 500;
  const buckets = new Map();
  for (const node of spec.nodes) {
    const level = levels.get(node.id) ?? 1;
    if (!buckets.has(level)) buckets.set(level, []);
    buckets.get(level).push(nodes.get(node.id));
  }

  for (const [level, levelNodes] of buckets) {
    levelNodes.sort((a, b) => a.id.localeCompare(b.id));
    if (level === 0) {
      const node = levelNodes[0];
      node.x = centerX - node.width / 2;
      node.y = centerY - node.height / 2;
      continue;
    }
    const radius = 300 * level;
    levelNodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / levelNodes.length;
      node.x = centerX + Math.cos(angle) * radius - node.width / 2;
      node.y = centerY + Math.sin(angle) * radius - node.height / 2;
    });
  }
}

function sequenceLayout(spec, nodes, settings) {
  [...nodes.values()].sort(orderNodes).forEach((node, index) => {
    node.x = settings.margin + index * (node.width + settings.gapX);
    node.y = settings.margin;
  });
}

function swimlaneLayout(spec, nodes, settings) {
  const laneOrder = new Map(spec.lanes.map((lane, index) => [String(lane.id), lane.order ?? index]));
  const buckets = new Map();
  for (const node of nodes.values()) {
    const laneId = String(node.laneId ?? spec.lanes[0]?.id ?? "default");
    if (!buckets.has(laneId)) buckets.set(laneId, []);
    buckets.get(laneId).push(node);
  }

  const lanes = [...buckets.entries()].sort(
    ([a], [b]) => (laneOrder.get(a) ?? 999) - (laneOrder.get(b) ?? 999) || a.localeCompare(b),
  );
  lanes.forEach(([laneId, laneNodes], laneIndex) => {
    laneNodes.sort(orderNodes).forEach((node, nodeIndex) => {
      node.x = settings.margin + laneIndex * (settings.nodeWidth + settings.gapX + 100);
      node.y = settings.margin + 80 + nodeIndex * (settings.nodeHeight + settings.gapY);
      node.frameSemanticId = `lane:${laneId}`;
    });
  });
}

function ganttLayout(spec, nodes, settings) {
  [...nodes.values()].sort(orderNodes).forEach((node, index) => {
    const start = Number(node.data?.start ?? 0);
    const duration = Math.max(1, Number(node.data?.duration ?? 1));
    node.x = settings.margin + 180 + start * 80;
    node.y = settings.margin + index * 100;
    node.width = Math.max(100, duration * 80);
    node.height = 54;
  });
}

function timelineLayout(spec, nodes, settings) {
  [...nodes.values()].sort(orderNodes).forEach((node, index) => {
    node.x = settings.margin + index * (node.width + settings.gapX);
    node.y = settings.margin + (index % 2 === 0 ? 0 : 220);
  });
}

function fishboneLayout(spec, nodes, settings) {
  const result = [...nodes.values()].find((node) => node.kind === "result") ?? [...nodes.values()].at(-1);
  const causes = [...nodes.values()].filter((node) => node !== result).sort(orderNodes);
  causes.forEach((node, index) => {
    node.x = settings.margin + index * 240;
    node.y = settings.margin + (index % 2 === 0 ? 0 : 300);
  });
  result.x = settings.margin + Math.max(2, causes.length) * 240;
  result.y = settings.margin + 150;
}

function matrixLayout(spec, nodes, settings) {
  const columns = Number(spec.layout.columns ?? (spec.type === "swot" ? 2 : Math.ceil(Math.sqrt(nodes.size))));
  [...nodes.values()].sort(orderNodes).forEach((node, index) => {
    node.x = settings.margin + (index % columns) * (node.width + 40);
    node.y = settings.margin + Math.floor(index / columns) * (node.height + 40);
  });
}

function stackLayout(spec, nodes, settings) {
  const values = [...nodes.values()].sort(orderNodes);
  const maxWidth = 700;
  values.forEach((node, index) => {
    const ratio = spec.type === "funnel"
      ? 1 - (index / Math.max(1, values.length)) * 0.6
      : 0.4 + (index / Math.max(1, values.length - 1)) * 0.6;
    node.width = Math.max(180, maxWidth * ratio);
    node.height = 86;
    node.x = settings.margin + (maxWidth - node.width) / 2;
    node.y = settings.margin + index * 110;
  });
}

function vennLayout(spec, nodes, settings) {
  const values = [...nodes.values()].sort(orderNodes);
  const centerX = settings.margin + 400;
  const centerY = settings.margin + 300;
  values.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, values.length);
    node.width = Math.max(node.width, 320);
    node.height = Math.max(node.height, 260);
    node.x = centerX + Math.cos(angle) * 120 - node.width / 2;
    node.y = centerY + Math.sin(angle) * 90 - node.height / 2;
  });
}

function gridLayout(spec, nodes, settings) {
  const columns = Number(spec.layout.columns ?? Math.ceil(Math.sqrt(nodes.size)));
  [...nodes.values()].sort(orderNodes).forEach((node, index) => {
    node.x = settings.margin + (index % columns) * (settings.nodeWidth + settings.gapX);
    node.y = settings.margin + Math.floor(index / columns) * (settings.nodeHeight + settings.gapY);
  });
}

function calculateRanks(spec) {
  const outgoing = new Map(spec.nodes.map((node) => [node.id, []]));
  const targeted = new Set();
  for (const edge of spec.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    targeted.add(edge.to);
  }
  const roots = spec.nodes.map((node) => node.id).filter((id) => !targeted.has(id));
  const queue = (roots.length > 0 ? roots : [spec.nodes[0].id]).sort();
  const ranks = new Map(queue.map((id) => [id, 0]));
  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of [...(outgoing.get(current) ?? [])].sort()) {
      if (!ranks.has(target)) {
        ranks.set(target, (ranks.get(current) ?? 0) + 1);
        queue.push(target);
      }
    }
  }
  for (const node of spec.nodes) {
    if (!ranks.has(node.id)) ranks.set(node.id, 0);
  }
  return ranks;
}

function findRoot(spec) {
  const explicit = spec.nodes.find((node) => node.kind === "root");
  if (explicit) return explicit.id;
  const targeted = new Set(spec.edges.map((edge) => edge.to));
  return spec.nodes.find((node) => !targeted.has(node.id))?.id ?? spec.nodes[0].id;
}

function breadthLevels(spec, rootId) {
  const outgoing = new Map(spec.nodes.map((node) => [node.id, []]));
  for (const edge of spec.edges) outgoing.get(edge.from)?.push(edge.to);
  const levels = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of outgoing.get(current) ?? []) {
      if (!levels.has(target)) {
        levels.set(target, levels.get(current) + 1);
        queue.push(target);
      }
    }
  }
  return levels;
}

function applyStablePositions(spec, nodes, existing) {
  for (const nodeSpec of spec.nodes) {
    const node = nodes.get(nodeSpec.id);
    const position = nodeSpec.position ?? existing.get(nodeSpec.id);
    if (!position) continue;
    node.x = Number(position.x);
    node.y = Number(position.y);
    if (Number.isFinite(position.width)) node.width = Number(position.width);
    if (Number.isFinite(position.height)) node.height = Number(position.height);
  }
}

function settleNewNodes(nodes, existing, settings) {
  const occupied = [...nodes.values()].filter((node) => existing.has(node.id));
  for (const node of [...nodes.values()].filter((item) => !existing.has(item.id))) {
    let attempts = 0;
    while (occupied.some((other) => overlaps(node, other, 40)) && attempts < 50) {
      node.y += settings.nodeHeight + settings.gapY;
      attempts += 1;
    }
    occupied.push(node);
  }
}

function overlaps(a, b, padding = 0) {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function buildFrames(spec, nodes, settings) {
  const frames = [];
  for (const group of spec.groups) {
    const members = [...nodes.values()].filter((node) => node.groupId === group.id);
    if (members.length > 0) frames.push(frameBounds(group.id, group.label ?? group.id, members, settings));
  }

  for (const lane of spec.lanes) {
    const semanticId = `lane:${lane.id}`;
    const members = [...nodes.values()].filter((node) => node.frameSemanticId === semanticId);
    if (members.length > 0) frames.push(frameBounds(semanticId, lane.label ?? String(lane.id), members, settings));
  }

  if (nodes.size > 30 && frames.length === 0) {
    const ordered = [...nodes.values()].sort(orderNodes);
    for (let index = 0; index < ordered.length; index += 30) {
      const members = ordered.slice(index, index + 30);
      const semanticId = `auto-frame-${Math.floor(index / 30) + 1}`;
      frames.push(frameBounds(semanticId, `View ${Math.floor(index / 30) + 1}`, members, settings));
      members.forEach((node) => {
        node.frameSemanticId = semanticId;
      });
    }
  }
  return frames;
}

function frameBounds(semanticId, label, members, settings) {
  const minX = Math.min(...members.map((node) => node.x));
  const minY = Math.min(...members.map((node) => node.y));
  const maxX = Math.max(...members.map((node) => node.x + node.width));
  const maxY = Math.max(...members.map((node) => node.y + node.height));
  return {
    semanticId,
    label,
    x: minX - settings.framePadding,
    y: minY - settings.framePadding,
    width: maxX - minX + settings.framePadding * 2,
    height: maxY - minY + settings.framePadding * 2,
  };
}

function assignFrames(nodes, frames) {
  const known = new Set(frames.map((frame) => frame.semanticId));
  for (const node of nodes.values()) {
    const candidate = node.frameSemanticId ?? node.groupId;
    node.frameSemanticId = candidate && known.has(candidate) ? candidate : null;
  }
}

function orderNodes(a, b) {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

export function nodeCenter(node) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function connectionGeometry(from, to) {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let startFixedPoint;
  let endFixedPoint;
  let start;
  let end;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const rightward = dx >= 0;
    startFixedPoint = [rightward ? 1 : 0, 0.5];
    endFixedPoint = [rightward ? 0 : 1, 0.5];
    start = { x: rightward ? from.x + from.width : from.x, y: a.y };
    end = { x: rightward ? to.x : to.x + to.width, y: b.y };
  } else {
    const downward = dy >= 0;
    startFixedPoint = [0.5, downward ? 1 : 0];
    endFixedPoint = [0.5, downward ? 0 : 1];
    start = { x: a.x, y: downward ? from.y + from.height : from.y };
    end = { x: b.x, y: downward ? to.y : to.y + to.height };
  }

  return {
    x: round(start.x),
    y: round(start.y),
    width: round(Math.abs(end.x - start.x)),
    height: round(Math.abs(end.y - start.y)),
    points: [[0, 0], [round(end.x - start.x), round(end.y - start.y)]],
    startFixedPoint,
    endFixedPoint,
  };
}
