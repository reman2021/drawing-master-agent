import { hash32, normalizeSpec, RUNTIME_VERSION } from "./core.mjs";
import { hashSpec } from "./formats.mjs";
import { layoutDiagram } from "./layout.mjs";

export const MERMAID_FORMAT_VERSION = 1;

export function compileMermaid(input) {
  const spec = normalizeSpec(input);
  const layout = layoutDiagram(spec);
  const warnings = [];
  const ids = new Map(spec.nodes.map((node) => [node.id, mermaidId(spec.documentId, node.id)]));
  let diagramType = spec.type;
  let body;

  const hasUnsupportedNativeContent = (spec.groups.length > 0 || spec.lanes.length > 0 || spec.annotations.length > 0)
    && spec.type !== "sequence";
  if (spec.type === "flowchart") body = compileFlowchart(spec, ids);
  else if (spec.type === "sequence") body = compileSequence(spec, ids);
  else if (spec.type === "class" && !hasUnsupportedNativeContent) body = compileClass(spec, ids);
  else if (spec.type === "state" && !hasUnsupportedNativeContent) body = compileState(spec, ids);
  else if (spec.type === "er" && !hasUnsupportedNativeContent && supportsEr(spec)) body = compileEr(spec, ids);
  else if (spec.type === "gantt" && !hasUnsupportedNativeContent && supportsGantt(spec)) body = compileGantt(spec, ids);
  else if (spec.type === "mindmap" && !hasUnsupportedNativeContent && supportsMindmap(spec)) {
    body = compileMindmap(spec, ids);
    warnings.push(warning("format.experimental", "Mermaid mindmap output is experimental."));
  } else if (spec.type === "timeline" && !hasUnsupportedNativeContent && supportsTimeline(spec)) {
    body = compileTimeline(spec);
    warnings.push(warning("format.experimental", "Mermaid timeline output is experimental."));
  } else {
    diagramType = "flowchart";
    body = compileFlowchart(spec, ids);
    warnings.push(warning(
      "format.degraded",
      `Diagram type ${spec.type} was rendered as a Mermaid flowchart because its native semantics are unavailable.`,
    ));
  }

  const metadata = {
    documentId: spec.documentId,
    specHash: hashSpec(spec),
    runtimeVersion: RUNTIME_VERSION,
    schemaVersion: spec.schemaVersion,
    formatVersion: MERMAID_FORMAT_VERSION,
    chartType: spec.type,
    diagramType,
  };
  const content = `%% drawing-master ${safeJson(metadata)}\n${body.join("\n")}\n`;
  return { content, spec, layout, formatVersion: MERMAID_FORMAT_VERSION, warnings };
}

function compileFlowchart(spec, ids) {
  const direction = ["TB", "TD", "BT", "RL", "LR"].includes(String(spec.layout.direction).toUpperCase())
    ? String(spec.layout.direction).toUpperCase()
    : "TB";
  const lines = [`flowchart ${direction}`];
  const assigned = new Set();
  for (const partition of flowchartPartitions(spec)) {
    const members = spec.nodes.filter((node) => partition.matches(node));
    if (members.length === 0) continue;
    lines.push(`  subgraph ${partition.id}["${escapeText(partition.label)}"]`);
    for (const node of members) {
      lines.push(`    ${nodeSyntax(ids.get(node.id), node)}`);
      assigned.add(node.id);
    }
    lines.push("  end");
  }
  for (const node of spec.nodes.filter((item) => !assigned.has(item.id))) {
    lines.push(`  ${nodeSyntax(ids.get(node.id), node)}`);
  }
  for (const [index, annotation] of spec.annotations.entries()) {
    const id = mermaidId(spec.documentId, `annotation:${annotation.id ?? index + 1}`);
    lines.push(`  ${id}["${escapeText(annotation.text ?? "")}"]`);
  }
  for (const edge of spec.edges) {
    const label = edge.label ? `|"${escapeText(edge.label)}"|` : "";
    lines.push(`  ${ids.get(edge.from)} ${flowchartArrow(edge.kind)}${label} ${ids.get(edge.to)}`);
  }
  return lines;
}

function compileSequence(spec, ids) {
  const lines = ["sequenceDiagram"];
  const assigned = new Set();
  for (const partition of sequencePartitions(spec)) {
    const members = [...spec.nodes].filter((node) => partition.matches(node)).sort(orderNodes);
    if (members.length === 0) continue;
    lines.push(`  box ${escapeText(partition.label)}`);
    for (const node of members) {
      lines.push(sequenceParticipant(node, ids));
      assigned.add(node.id);
    }
    lines.push("  end");
  }
  for (const node of [...spec.nodes].filter((item) => !assigned.has(item.id)).sort(orderNodes)) {
    lines.push(sequenceParticipant(node, ids));
  }
  for (const edge of spec.edges) {
    const arrow = edge.kind === "return" ? "-->>" : edge.kind === "association" ? "->" : "->>";
    lines.push(`  ${ids.get(edge.from)}${arrow}${ids.get(edge.to)}: ${escapeText(edge.label || edge.id)}`);
  }
  const first = ids.get([...spec.nodes].sort(orderNodes)[0].id);
  for (const annotation of spec.annotations) {
    lines.push(`  Note over ${first}: ${escapeText(annotation.text ?? "")}`);
  }
  return lines;
}

function compileClass(spec, ids) {
  const lines = ["classDiagram"];
  for (const node of spec.nodes) lines.push(`  class ${ids.get(node.id)}["${escapeText(node.label)}"]`);
  const arrows = {
    inheritance: "--|>",
    composition: "*--",
    aggregation: "o--",
    association: "--",
    bidirectional: "<-->",
  };
  for (const edge of spec.edges) {
    const arrow = arrows[edge.kind] ?? "-->";
    const label = edge.label ? ` : ${escapeText(edge.label)}` : "";
    lines.push(`  ${ids.get(edge.from)} ${arrow} ${ids.get(edge.to)}${label}`);
  }
  return lines;
}

function compileState(spec, ids) {
  const lines = ["stateDiagram-v2"];
  for (const node of spec.nodes) {
    if (!["start", "end"].includes(node.kind)) {
      lines.push(`  state "${escapeText(node.label)}" as ${ids.get(node.id)}`);
    }
  }
  for (const edge of spec.edges) {
    const from = spec.nodes.find((node) => node.id === edge.from)?.kind === "start" ? "[*]" : ids.get(edge.from);
    const to = spec.nodes.find((node) => node.id === edge.to)?.kind === "end" ? "[*]" : ids.get(edge.to);
    const label = edge.label ? ` : ${escapeText(edge.label)}` : "";
    lines.push(`  ${from} --> ${to}${label}`);
  }
  return lines;
}

function supportsEr(spec) {
  return spec.nodes.every((node) => node.kind === "entity")
    && spec.edges.every((edge) => Boolean(erCardinality(edge)));
}

function compileEr(spec, ids) {
  const lines = ["erDiagram"];
  for (const node of spec.nodes) {
    const [name, ...attributes] = String(node.label).split(/\r?\n/u);
    lines.push(`  ${ids.get(node.id)}["${escapeText(name)}"] {`);
    for (const [index, attribute] of attributes.entries()) {
      const parts = attribute.trim().split(/\s+/u).filter(Boolean);
      const field = safeIdentifier(parts[0] ?? `field_${index + 1}`);
      const key = parts.find((part) => /^(PK|FK|UK)$/iu.test(part));
      lines.push(`    string ${field}${key ? ` ${key.toUpperCase()}` : ""}`);
    }
    lines.push("  }");
  }
  for (const edge of spec.edges) {
    const cardinality = erCardinality(edge);
    const relation = edge.data?.relationship ?? edge.relationship ?? "relates";
    lines.push(
      `  ${ids.get(edge.from)} ${cardinality.from}--${cardinality.to} ${ids.get(edge.to)} : "${escapeText(relation)}"`,
    );
  }
  return lines;
}

function erCardinality(edge) {
  const explicitFrom = edge.data?.fromCardinality ?? edge.cardinality?.from;
  const explicitTo = edge.data?.toCardinality ?? edge.cardinality?.to;
  let from = explicitFrom;
  let to = explicitTo;
  if (from == null || to == null) {
    const match = String(edge.label).match(/^\s*([^:]+)\s*:\s*([^:]+)\s*$/u);
    if (!match) return null;
    [, from, to] = match;
  }
  const mappedFrom = cardinalitySymbol(from);
  const mappedTo = cardinalitySymbol(to);
  return mappedFrom && mappedTo ? { from: mappedFrom, to: mappedTo } : null;
}

function cardinalitySymbol(value) {
  const token = String(value).trim().toLowerCase();
  if (["1", "one", "exactly-one"].includes(token)) return "||";
  if (["0..1", "zero-or-one", "optional"].includes(token)) return "o|";
  if (["1..*", "1..n", "one-or-more"].includes(token)) return "|{";
  if (["*", "n", "many", "0..*", "0..n", "zero-or-more"].includes(token)) return "o{";
  return null;
}

function supportsGantt(spec) {
  return spec.edges.length === 0 && spec.nodes.every((node) => {
    const start = node.data?.start;
    const duration = node.data?.duration ?? (Number.isInteger(node.data?.durationDays) ? `${node.data.durationDays}d` : null);
    const end = node.data?.end;
    return /^\d{4}-\d{2}-\d{2}$/u.test(String(start ?? ""))
      && (/^\d+(?:\.\d+)?[dhwm]$/u.test(String(duration ?? "")) || /^\d{4}-\d{2}-\d{2}$/u.test(String(end ?? "")));
  });
}

function compileGantt(spec, ids) {
  const lines = ["gantt", "  dateFormat YYYY-MM-DD", "  axisFormat %Y-%m-%d"];
  let section = null;
  for (const node of [...spec.nodes].sort(orderNodes)) {
    const nextSection = node.data?.section ? escapeText(node.data.section) : null;
    if (nextSection && nextSection !== section) {
      lines.push(`  section ${nextSection}`);
      section = nextSection;
    }
    const finish = node.data.duration ?? (Number.isInteger(node.data.durationDays) ? `${node.data.durationDays}d` : node.data.end);
    lines.push(`  ${escapeText(node.label)} :${ids.get(node.id)}, ${node.data.start}, ${finish}`);
  }
  return lines;
}

function supportsMindmap(spec) {
  if (spec.edges.some((edge) => edge.label)) return false;
  const indegree = new Map(spec.nodes.map((node) => [node.id, 0]));
  for (const edge of spec.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const roots = spec.nodes.filter((node) => node.kind === "root");
  const candidates = roots.length === 1 ? roots : spec.nodes.filter((node) => indegree.get(node.id) === 0);
  if (candidates.length !== 1 || spec.edges.length !== spec.nodes.length - 1) return false;
  if (spec.nodes.some((node) => node.id !== candidates[0].id && indegree.get(node.id) !== 1)) return false;
  const reached = new Set([candidates[0].id]);
  const queue = [candidates[0].id];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of spec.edges.filter((item) => item.from === current)) {
      if (reached.has(edge.to)) return false;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reached.size === spec.nodes.length;
}

function compileMindmap(spec, ids) {
  const targeted = new Set(spec.edges.map((edge) => edge.to));
  const root = spec.nodes.find((node) => node.kind === "root")
    ?? spec.nodes.find((node) => !targeted.has(node.id));
  const byParent = new Map();
  for (const edge of spec.edges) {
    if (!byParent.has(edge.from)) byParent.set(edge.from, []);
    byParent.get(edge.from).push(edge.to);
  }
  const nodes = new Map(spec.nodes.map((node) => [node.id, node]));
  const lines = ["mindmap"];
  appendMindmapNode(lines, root.id, 1, nodes, byParent, ids);
  return lines;
}

function appendMindmapNode(lines, nodeId, depth, nodes, byParent, ids) {
  lines.push(`${"  ".repeat(depth)}${ids.get(nodeId)}["${escapeText(nodes.get(nodeId).label)}"]`);
  const children = [...(byParent.get(nodeId) ?? [])].sort();
  for (const child of children) appendMindmapNode(lines, child, depth + 1, nodes, byParent, ids);
}

function supportsTimeline(spec) {
  return spec.edges.length === 0 && spec.nodes.every((node) => {
    const time = node.data?.time ?? node.data?.date;
    return /^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u.test(String(time ?? ""));
  });
}

function compileTimeline(spec) {
  const lines = ["timeline"];
  for (const node of [...spec.nodes].sort(orderNodes)) {
    lines.push(`  ${escapeText(node.data.time ?? node.data.date)} : ${escapeText(node.label)}`);
  }
  return lines;
}

function nodeSyntax(id, node) {
  const label = escapeText(node.label);
  if (node.shape === "diamond" || node.kind === "decision" || node.kind === "relation") return `${id}{"${label}"}`;
  if (node.shape === "ellipse" || ["start", "end", "actor", "root", "concept", "attribute"].includes(node.kind)) {
    return `${id}(["${label}"])`;
  }
  return `${id}["${label}"]`;
}

function flowchartPartitions(spec) {
  return [
    ...spec.lanes.map((lane) => ({
      id: `lane_${hash32(`${spec.documentId}:lane:${lane.id}`).toString(36)}`,
      label: lane.label ?? lane.id,
      matches: (node) => String(node.laneId ?? "") === String(lane.id),
    })),
    ...spec.groups.map((group) => ({
      id: `group_${hash32(`${spec.documentId}:group:${group.id}`).toString(36)}`,
      label: group.label ?? group.id,
      matches: (node) => !node.laneId && String(node.groupId ?? "") === String(group.id),
    })),
  ];
}

function sequencePartitions(spec) {
  return flowchartPartitions(spec);
}

function sequenceParticipant(node, ids) {
  const keyword = node.kind === "actor" ? "actor" : "participant";
  return `    ${keyword} ${ids.get(node.id)} as ${escapeText(node.label)}`;
}

function flowchartArrow(kind) {
  if (kind === "bidirectional") return "<-->";
  if (kind === "association") return "---";
  if (kind === "return") return "-.->";
  return "-->";
}

function mermaidId(documentId, semanticId) {
  return `n_${hash32(`${documentId}:mermaid:${semanticId}`).toString(36)}`;
}

function safeIdentifier(value) {
  const token = String(value).normalize("NFKD").replace(/[^A-Za-z0-9_]/gu, "_").replace(/^([^A-Za-z_])/u, "_$1");
  return token || "field";
}

function escapeText(value) {
  const escaped = {
    "&": "#38;",
    "<": "#60;",
    ">": "#62;",
    '"': "#34;",
    "'": "#39;",
    "`": "#96;",
    "\\": "#92;",
    "%": "#37;",
    "{": "#123;",
    "}": "#125;",
    "[": "#91;",
    "]": "#93;",
    "(": "#40;",
    ")": "#41;",
    "|": "#124;",
    ":": "#58;",
    ",": "#44;",
    ";": "#59;",
    "#": "#35;",
  };
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\r?\n|\r/gu, " / ")
    .replace(/[&<>"'`\\%{}[\]()|:,;#]/gu, (character) => escaped[character]);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/&/gu, "\\u0026");
}

function warning(code, message) {
  return { code, message };
}

function orderNodes(a, b) {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}
