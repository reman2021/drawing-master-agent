export function validateDrawio(content, options = {}) {
  const errors = [];
  const warnings = [];
  if (typeof content !== "string") {
    push(errors, "drawio.invalid", "draw.io content must be a string.");
    return qualityReport(errors, warnings, options);
  }
  const tags = validateWellFormedXml(content, errors);
  validateSafety(content, errors, options.requireMetadata === true, tags);
  validateStructure(content, errors);
  const cells = readCells(content, errors);
  validateCells(cells, errors);
  validateGeometry(content, errors);
  validateVisualOverlaps(content, warnings);
  return qualityReport(errors, warnings, options);
}

export const validateDrawioDocument = validateDrawio;

function validateSafety(content, errors, requireMetadata, tags) {
  if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>\r?\n/u.test(content)) {
    push(errors, "safety.xmlDeclaration", "A UTF-8 XML declaration is required.");
  }
  const mxfile = content.match(/<mxfile\b([^>]*)>/u)?.[1] ?? "";
  const attributes = parseAttributes(mxfile);
  if (attributes.compressed !== "false") push(errors, "safety.compression", "mxfile must declare compressed=false.");
  for (const field of ["documentId", "specHash", "runtimeVersion", "formatVersion"]) {
    if (requireMetadata && !attributes[field]) push(errors, "metadata.field", `mxfile metadata field ${field} is required.`);
  }
  if (attributes.specHash && !/^[0-9a-f]{64}$/u.test(attributes.specHash)) {
    push(errors, "metadata.specHash", "mxfile specHash must be a SHA-256 hex digest.");
  }
  const forbidden = [
    [/<!DOCTYPE/iu, "safety.doctype", "DOCTYPE declarations are not allowed."],
    [/<script\b/iu, "safety.script", "Script elements are not allowed."],
  ];
  for (const [pattern, code, message] of forbidden) {
    if (pattern.test(content)) push(errors, code, message);
  }
  for (const tag of tags) {
    const tagAttributes = tag.attributes;
    for (const [name, value] of Object.entries(tagAttributes)) {
      if (/^on[a-z]+$/iu.test(name)) push(errors, "safety.event", `Event handler attribute ${name} is not allowed.`);
      if (/^(?:href|link)$/iu.test(name)) push(errors, "safety.link", `Active link attribute ${name} is not allowed.`);
      if (/^(?:href|link|src)$/iu.test(name) && /^(?:javascript|data|vbscript)\s*:/iu.test(value)) {
        push(errors, "safety.uri", `Active URI scheme in ${name} is not allowed.`);
      }
    }
  }
}

function validateWellFormedXml(content, errors) {
  const allowed = new Set(["mxfile", "diagram", "mxGraphModel", "root", "mxCell", "mxGeometry", "Array", "mxPoint"]);
  const parents = {
    mxfile: null,
    diagram: "mxfile",
    mxGraphModel: "diagram",
    root: "mxGraphModel",
    mxCell: "root",
    mxGeometry: "mxCell",
    Array: "mxGeometry",
    mxPoint: "Array",
  };
  const stack = [];
  const tags = [];
  for (const character of content) {
    if (!isXmlCodePoint(character.codePointAt(0))) {
      push(errors, "xml.character", `XML contains a character forbidden by XML 1.0: U+${character.codePointAt(0).toString(16).toUpperCase()}.`);
      break;
    }
  }
  let index = 0;
  while (index < content.length) {
    const start = content.indexOf("<", index);
    if (start < 0) break;
    if (content.startsWith("<!--", start)) {
      const end = content.indexOf("-->", start + 4);
      if (end < 0) {
        push(errors, "xml.wellFormed", "XML comment is not closed.");
        return tags;
      }
      index = end + 3;
      continue;
    }
    if (content.startsWith("<?", start)) {
      const end = content.indexOf("?>", start + 2);
      if (end < 0) {
        push(errors, "xml.wellFormed", "XML processing instruction is not closed.");
        return tags;
      }
      if (start !== 0 || !content.startsWith("<?xml ", start)) {
        push(errors, "xml.processingInstruction", "Only the leading XML declaration is allowed.");
      }
      index = end + 2;
      continue;
    }
    const end = findTagEnd(content, start + 1);
    if (end < 0) {
      push(errors, "xml.wellFormed", "XML tag is not closed.");
      return tags;
    }
    const raw = content.slice(start + 1, end).trim();
    if (raw.startsWith("!")) {
      push(errors, "xml.declaration", "XML declarations other than the XML header are not allowed.");
      index = end + 1;
      continue;
    }
    const closing = raw.startsWith("/");
    const selfClosing = raw.endsWith("/");
    const body = raw.replace(/^\//u, "").replace(/\/$/u, "").trim();
    const name = body.match(/^([A-Za-z_][\w:.-]*)/u)?.[1];
    if (!name) {
      push(errors, "xml.wellFormed", "XML tag name is invalid.");
      index = end + 1;
      continue;
    }
    if (!allowed.has(name)) push(errors, "xml.element", `Unsupported XML element: ${name}.`);
    const attributeSource = body.slice(name.length);
    const attributes = closing ? {} : validateAttributeSyntax(attributeSource, errors, name);
    if (closing) {
      const expected = stack.pop();
      if (expected !== name) push(errors, "xml.wellFormed", `Closing tag ${name} does not match ${expected ?? "(none)"}.`);
    } else if (!selfClosing) {
      if ((parents[name] ?? null) !== (stack.at(-1) ?? null)) {
        push(errors, "xml.hierarchy", `Element ${name} must be inside ${parents[name] ?? "the document root"}.`);
      }
      stack.push(name);
    } else if ((parents[name] ?? null) !== (stack.at(-1) ?? null)) {
      push(errors, "xml.hierarchy", `Element ${name} must be inside ${parents[name] ?? "the document root"}.`);
    }
    if (!closing) tags.push({ name, attributes, selfClosing });
    index = end + 1;
  }
  if (stack.length > 0) push(errors, "xml.wellFormed", `XML element ${stack.at(-1)} is not closed.`);
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/iu.test(content)) {
    push(errors, "xml.entity", "XML contains an invalid or unsupported entity reference.");
  }
  const numericEntities = content.matchAll(/&#(?:x([0-9a-f]+)|(\d+));/giu);
  for (const match of numericEntities) {
    const value = match[1] ? Number.parseInt(match[1], 16) : Number.parseInt(match[2], 10);
    if (!isXmlCodePoint(value)) push(errors, "xml.entity", `XML numeric entity ${match[0]} is not valid in XML 1.0.`);
  }
  return tags;
}

function validateStructure(content, errors) {
  const compact = content.replace(/<\?xml[^?]*\?>/u, "").trim();
  if (!/^<mxfile\b[\s\S]*<diagram\b[\s\S]*<mxGraphModel\b[\s\S]*<root>[\s\S]*<\/root>[\s\S]*<\/mxGraphModel>[\s\S]*<\/diagram>[\s\S]*<\/mxfile>$/u.test(compact)) {
    push(errors, "structure.root", "Expected mxfile/diagram/mxGraphModel/root structure.");
  }
  if ((content.match(/<diagram\b/gu) ?? []).length !== 1) {
    push(errors, "structure.pageCount", "Exactly one draw.io page is required.");
  }
  const model = parseAttributes(content.match(/<mxGraphModel\b([^>]*)>/u)?.[1] ?? "");
  if (model.htmlLabels !== "0") push(errors, "safety.htmlLabels", "mxGraphModel must disable HTML labels.");
  if (!/<mxCell\s+id="0"\s*\/>/u.test(content) || !/<mxCell\s+id="1"\s+parent="0"\s*\/>/u.test(content)) {
    push(errors, "structure.baseCells", "Root cells 0 and 1 are required.");
  }
}

function readCells(content, errors) {
  const cells = [];
  const pattern = /<mxCell\b([^>]*)>/gu;
  let match;
  while ((match = pattern.exec(content))) {
    const attributes = parseAttributes(match[1]);
    if (!attributes.id) push(errors, "cell.id", "Every mxCell must have an id.");
    cells.push(attributes);
  }
  return cells;
}

function validateCells(cells, errors) {
  const ids = new Set();
  for (const cell of cells) {
    if (!cell.id) continue;
    if (ids.has(cell.id)) push(errors, "cell.duplicateId", `Duplicate mxCell id: ${cell.id}.`);
    ids.add(cell.id);
  }
  for (const cell of cells) {
    for (const field of ["parent", "source", "target"]) {
      if (cell[field] && !ids.has(cell[field])) {
        push(errors, "cell.reference", `${cell.id ?? "(unknown)"}.${field} references missing cell ${cell[field]}.`);
      }
    }
    if (cell.edge === "1" && (!cell.source || !cell.target)) {
      push(errors, "edge.reference", `Edge ${cell.id ?? "(unknown)"} must have source and target references.`);
    }
    if ((cell.vertex === "1" || cell.edge === "1") && !/(?:^|;)html=0(?:;|$)/u.test(cell.style ?? "")) {
      push(errors, "safety.cellHtml", `Cell ${cell.id ?? "(unknown)"} must disable HTML labels.`);
    }
    if (/(?:^|;)(?:link|image)=/iu.test(cell.style ?? "")) {
      push(errors, "safety.cellLink", `Cell ${cell.id ?? "(unknown)"} contains an active resource style.`);
    }
  }
}

function validateGeometry(content, errors) {
  const pattern = /<(mxGeometry|mxPoint)\b([^>]*)\/>/gu;
  let match;
  while ((match = pattern.exec(content))) {
    const element = match[1];
    const attributes = parseAttributes(match[2]);
    for (const field of ["x", "y", "width", "height"]) {
      if (attributes[field] == null) continue;
      const value = Number(attributes[field]);
      if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) {
        push(errors, "geometry.finite", `mxGeometry ${field} must be a finite, bounded number.`);
      }
      if (["width", "height"].includes(field) && value < 0) {
        push(errors, "geometry.size", `mxGeometry ${field} must not be negative.`);
      }
    }
    if (element === "mxGeometry" && attributes.relative !== "1" && (attributes.width == null || attributes.height == null)) {
      push(errors, "geometry.size", "Vertex geometry must include width and height.");
    }
    if (element === "mxPoint" && (attributes.x == null || attributes.y == null)) {
      push(errors, "geometry.point", "mxPoint must include x and y.");
    }
  }
}

function validateVisualOverlaps(content, warnings) {
  const vertices = [];
  const pattern = /<mxCell\b([^>]*)vertex="1"([^>]*)>\s*<mxGeometry\b([^>]*)\/>\s*<\/mxCell>/gu;
  let match;
  while ((match = pattern.exec(content))) {
    const cell = parseAttributes(`${match[1]} ${match[2]}`);
    const geometry = parseAttributes(match[3]);
    if (/(?:^|;)(?:container=1|swimlane)(?:;|$)/u.test(cell.style ?? "")) continue;
    if (["x", "y", "width", "height"].some((field) => !Number.isFinite(Number(geometry[field])))) continue;
    vertices.push({
      id: cell.id,
      parent: cell.parent,
      x: Number(geometry.x),
      y: Number(geometry.y),
      width: Number(geometry.width),
      height: Number(geometry.height),
    });
  }
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      const a = vertices[i];
      const b = vertices[j];
      if (a.parent !== b.parent) continue;
      const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && (width * height) / smaller > 0.08) {
        push(warnings, "visual.nodeOverlap", `${a.id} overlaps ${b.id}.`);
      }
    }
  }
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/gu;
  let match;
  while ((match = pattern.exec(source))) attributes[match[1]] = decodeXml(match[3]);
  return attributes;
}

function validateAttributeSyntax(source, errors, elementName) {
  const attributes = parseAttributes(source);
  const names = [];
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/gu)) {
    names.push(match[1]);
    if (match[3].includes("<")) push(errors, "xml.attribute", `Element ${elementName} contains an unescaped < in an attribute.`);
  }
  if (new Set(names).size !== names.length) {
    push(errors, "xml.attributeDuplicate", `Element ${elementName} contains duplicate attributes.`);
  }
  const remainder = source.replace(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/gu, "").trim();
  if (remainder) push(errors, "xml.attribute", `Element ${elementName} contains malformed attributes.`);
  return attributes;
}

function findTagEnd(content, offset) {
  let quote = null;
  for (let index = offset; index < content.length; index += 1) {
    const value = content[index];
    if (quote) {
      if (value === quote) quote = null;
      continue;
    }
    if (value === '"' || value === "'") quote = value;
    else if (value === ">") return index;
  }
  return -1;
}

function isXmlCodePoint(value) {
  return value === 0x9
    || value === 0xA
    || value === 0xD
    || (value >= 0x20 && value <= 0xD7FF)
    || (value >= 0xE000 && value <= 0xFFFD)
    || (value >= 0x10000 && value <= 0x10FFFF);
}

function decodeXml(value) {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function push(target, code, message) {
  target.push({ code, message });
}

import { qualityReport } from "./diagnostics.mjs";
