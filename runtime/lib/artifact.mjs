import crypto from "node:crypto";
import { compileSpec } from "./compiler.mjs";
import { compileDrawio } from "./drawio.mjs";
import { getFormat } from "./formats.mjs";
import { compileMermaid } from "./mermaid.mjs";
import { qualityReport } from "./diagnostics.mjs";
import { checkGeometry } from "./geometry.mjs";
import { validateDocument } from "./quality.mjs";
import { validateDrawio } from "./quality-drawio.mjs";
import { validateMermaid } from "./quality-mermaid.mjs";

export function compileArtifact(input, format, options = {}) {
  const definition = getFormat(format);
  if (definition.name === "excalidraw") {
    const compiled = compileSpec(input, { existingDocument: options.existingDocument });
    return finish(definition, compiled, compiled.document, 2, [], options);
  }
  if (definition.name === "mermaid") {
    const compiled = compileMermaid(input);
    return finish(definition, compiled, compiled.content, compiled.formatVersion, compiled.warnings, options);
  }
  const compiled = compileDrawio(input);
  return finish(definition, compiled, compiled.content, compiled.formatVersion, compiled.warnings, options);
}

export function validateArtifact(format, content, options = {}) {
  const name = getFormat(format).name;
  if (name === "excalidraw") return validateDocument(content, options);
  if (name === "mermaid") return validateMermaid(content, options);
  return validateDrawio(content, options);
}

export function serializeArtifact(format, content) {
  return getFormat(format).name === "excalidraw"
    ? `${JSON.stringify(content, null, 2)}\n`
    : ensureFinalNewline(String(content));
}

export function hashArtifact(format, content) {
  return crypto.createHash("sha256").update(serializeArtifact(format, content)).digest("hex");
}

export function parseArtifact(format, source, filePath = "artifact") {
  if (getFormat(format).name !== "excalidraw") return String(source);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export function readArtifactMetadata(format, content) {
  const name = getFormat(format).name;
  if (name === "excalidraw") return metadataObject(content?.drawingMaster);
  if (name === "mermaid") {
    const match = String(content).replace(/^\uFEFF/u, "").split(/\r\n?|\n/u)[0]
      .match(/^%% drawing-master (\{.*\})$/u);
    if (!match) return null;
    try {
      return metadataObject(JSON.parse(match[1]));
    } catch {
      return null;
    }
  }
  const attributes = String(content).match(/<mxfile\b([^>]*)>/u)?.[1] ?? "";
  const metadata = {};
  for (const match of attributes.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/gu)) {
    metadata[match[1]] = decodeXml(match[3]);
  }
  return metadataObject(metadata);
}

function finish(definition, compiled, content, formatVersion, compilerWarnings, options) {
  const validated = validateArtifact(definition.name, content, {
    requireMetadata: true,
    profile: "standard",
  });
  const geometryWarnings = compiled.spec.type === "sequence"
    ? []
    : checkGeometry(compiled.layout ?? {}).map((item) => ({ ...item, supportedFixes: ["reflow"] }));
  const quality = qualityReport(validated.errors, [
    ...compilerWarnings,
    ...validated.warnings,
    ...geometryWarnings,
  ], { profile: options.qualityProfile });
  return {
    ...compiled,
    format: definition.name,
    extension: definition.extension,
    content,
    formatVersion,
    quality,
  };
}

function ensureFinalNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : null;
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}
