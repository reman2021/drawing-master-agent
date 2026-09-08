const DECLARATIONS = new Set([
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "gantt",
  "mindmap",
  "timeline",
]);

export function validateMermaid(content, options = {}) {
  const errors = [];
  const warnings = [];
  if (typeof content !== "string") {
    push(errors, "mermaid.invalid", "Mermaid content must be a string.");
    return qualityReport(errors, warnings, options);
  }
  const lines = content.replace(/^\uFEFF/u, "").split(/\r\n?|\n/u);
  validateMetadata(lines[0] ?? "", errors, options.requireMetadata === true);
  validateSafety(content, errors);
  const declaration = lines.find((line) => line.trim() && !line.trim().startsWith("%%"));
  const keyword = declaration?.trim().split(/\s+/u)[0];
  if (!DECLARATIONS.has(keyword)) {
    push(errors, "mermaid.declaration", `Unsupported or missing Mermaid declaration: ${keyword ?? "(missing)"}.`);
  } else {
    validateKnownLines(keyword, lines, errors);
    validateReferences(keyword, lines, errors);
  }
  return qualityReport(errors, warnings, options);
}

export const validateMermaidDocument = validateMermaid;

function validateMetadata(line, errors, required) {
  const match = line.match(/^%% drawing-master (\{.*\})$/u);
  if (!match) {
    if (required) push(errors, "metadata.missing", "The first line must contain drawing-master metadata.");
    return;
  }
  try {
    const metadata = JSON.parse(match[1]);
    for (const field of ["documentId", "specHash", "runtimeVersion", "formatVersion"]) {
      if (metadata[field] == null || metadata[field] === "") {
        push(errors, "metadata.field", `Metadata field ${field} is required.`);
      }
    }
    if (!/^[0-9a-f]{64}$/u.test(String(metadata.specHash ?? ""))) {
      push(errors, "metadata.specHash", "Metadata specHash must be a SHA-256 hex digest.");
    }
  } catch {
    push(errors, "metadata.invalid", "drawing-master metadata must be valid JSON.");
  }
}

function validateSafety(content, errors) {
  const syntax = content.replace(/(?:&[A-Za-z]+|&?#\d+|&?#x[0-9a-f]+);/giu, "");
  const checks = [
    [/%%\s*\{/iu, "safety.directive", "Mermaid directives are not allowed."],
    [/(?:^|[;\r\n])\s*(?:click|link|links)\b/iu, "safety.click", "Mermaid active link actions are not allowed."],
    [/<\/?[A-Za-z][^>]*>/u, "safety.html", "Raw HTML is not allowed."],
    [/\b(?:javascript|data|vbscript)\s*:/iu, "safety.uri", "Active URI schemes are not allowed."],
    [/(?:^|[;\r\n])\s*(?:linkStyle|style|classDef)\b/iu, "safety.style", "Raw Mermaid style commands are not allowed."],
  ];
  for (const [pattern, code, message] of checks) {
    if (pattern.test(syntax)) push(errors, code, message);
  }
}

function validateKnownLines(type, lines, errors) {
  const sourceLines = lines.filter((line) => line.trim() && !line.trim().startsWith("%%"));
  const declarationIndex = sourceLines.findIndex((line) => line.trim().split(/\s+/u)[0] === type);
  const body = sourceLines.filter((_, index) => index !== declarationIndex);
  const patterns = {
    flowchart: [
      /^\s*subgraph\s+[A-Za-z_][\w-]*\[".*"\]\s*$/u,
      /^\s*end\s*$/u,
      /^\s*[A-Za-z_][\w-]*(?:\[".*"\]|\(\[".*"\]\)|\{".*"\})\s*$/u,
      /^\s*[A-Za-z_][\w-]*\s+(?:-->|<-->|---|-\.->)(?:\|".*"\|)?\s+[A-Za-z_][\w-]*\s*$/u,
    ],
    sequenceDiagram: [
      /^\s*box\s+.+$/u,
      /^\s*end\s*$/u,
      /^\s*(?:participant|actor)\s+[A-Za-z_][\w-]*\s+as\s+.+$/u,
      /^\s*[A-Za-z_][\w-]*(?:-->>|->>|->)[A-Za-z_][\w-]*:\s*.*$/u,
      /^\s*Note\s+over\s+[A-Za-z_][\w-]*:\s*.*$/u,
    ],
    classDiagram: [
      /^\s*class\s+[A-Za-z_][\w-]*\[".*"\]\s*$/u,
      /^\s*[A-Za-z_][\w-]*\s+(?:--\|>|\*--|o--|--|<-->|-->)\s+[A-Za-z_][\w-]*(?:\s+:\s+.*)?$/u,
    ],
    "stateDiagram-v2": [
      /^\s*state\s+".*"\s+as\s+[A-Za-z_][\w-]*\s*$/u,
      /^\s*(?:\[\*\]|[A-Za-z_][\w-]*)\s+-->\s+(?:\[\*\]|[A-Za-z_][\w-]*)(?:\s+:\s+.*)?$/u,
    ],
    erDiagram: [
      /^\s*[A-Za-z_][\w-]*\[".*"\]\s+\{\s*$/u,
      /^\s*string\s+[A-Za-z_][\w-]*(?:\s+(?:PK|FK|UK))?\s*$/u,
      /^\s*\}\s*$/u,
      /^\s*[A-Za-z_][\w-]*\s+(?:\|\||o\||\|\{|o\{)--(?:\|\||o\||\|\{|o\{)\s+[A-Za-z_][\w-]*\s+:\s+".*"\s*$/u,
    ],
    gantt: [
      /^\s*dateFormat\s+YYYY-MM-DD\s*$/u,
      /^\s*axisFormat\s+%Y-%m-%d\s*$/u,
      /^\s*section\s+.+$/u,
      /^\s*.+\s+:[A-Za-z_][\w-]*,\s*\d{4}-\d{2}-\d{2},\s*(?:\d+(?:\.\d+)?[dhwm]|\d{4}-\d{2}-\d{2})\s*$/u,
    ],
    mindmap: [/^\s+[A-Za-z_][\w-]*\[".*"\]\s*$/u],
    timeline: [/^\s*.+\s+:\s+.+$/u],
  };
  for (const line of body) {
    if (!(patterns[type] ?? []).some((pattern) => pattern.test(line))) {
      push(errors, "mermaid.syntaxSubset", `Unsupported Mermaid syntax: ${line.trim()}`);
    }
  }
}

function validateReferences(type, lines, errors) {
  const ids = new Set();
  const references = [];
  const add = (id) => {
    if (ids.has(id)) push(errors, "id.duplicate", `Duplicate Mermaid id: ${id}.`);
    ids.add(id);
  };
  for (const line of lines.slice(1)) {
    let match;
    if (type === "flowchart" && (match = line.match(/^\s*(n_[a-z0-9]+)(?:\[|\(|\{)/u))) add(match[1]);
    if (type === "sequenceDiagram" && (match = line.match(/^\s*(?:participant|actor)\s+(n_[a-z0-9]+)\s+as\s+/u))) add(match[1]);
    if (type === "classDiagram" && (match = line.match(/^\s*class\s+(n_[a-z0-9]+)(?:\[|\s|$)/u))) add(match[1]);
    if (type === "stateDiagram-v2" && (match = line.match(/^\s*state\s+".*"\s+as\s+(n_[a-z0-9]+)\s*$/u))) add(match[1]);
    if (type === "erDiagram" && (match = line.match(/^\s*(n_[a-z0-9]+)\["/u))) add(match[1]);
    if (type === "mindmap" && (match = line.match(/^\s+(n_[a-z0-9]+)\["/u))) add(match[1]);

    if (type === "flowchart" && (match = line.match(/^\s*(n_[a-z0-9]+)\s+(?:-->|<-->|---|-\.->)(?:\|.*\|)?\s*(n_[a-z0-9]+)\s*$/u))) references.push(match[1], match[2]);
    if (type === "sequenceDiagram" && (match = line.match(/^\s*(n_[a-z0-9]+)(?:-->>|->>|->)(n_[a-z0-9]+):/u))) references.push(match[1], match[2]);
    if (type === "classDiagram" && (match = line.match(/^\s*(n_[a-z0-9]+)\s+(?:--\|>|\*--|o--|--|<-->|-->)\s+(n_[a-z0-9]+)/u))) references.push(match[1], match[2]);
    if (type === "stateDiagram-v2" && (match = line.match(/^\s*(\[\*\]|n_[a-z0-9]+)\s+-->\s+(\[\*\]|n_[a-z0-9]+)/u))) {
      references.push(...match.slice(1).filter((id) => id !== "[*]"));
    }
    if (type === "erDiagram" && (match = line.match(/^\s*(n_[a-z0-9]+)\s+(?:\|\||o\||\|\{|o\{)--(?:\|\||o\||\|\{|o\{)\s+(n_[a-z0-9]+)\s+:/u))) {
      references.push(match[1], match[2]);
    }
  }
  for (const id of references) {
    if (!ids.has(id)) push(errors, "edge.reference", `Mermaid edge references missing id ${id}.`);
  }
}

function push(target, code, message) {
  target.push({ code, message });
}

import { qualityReport } from "./diagnostics.mjs";
