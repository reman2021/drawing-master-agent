import crypto from "node:crypto";
import path from "node:path";

const DEFINITIONS = [
  {
    name: "excalidraw",
    extension: ".excalidraw",
    extensions: [".excalidraw"],
    aliases: ["excalidraw"],
    mediaType: "application/vnd.excalidraw+json",
  },
  {
    name: "mermaid",
    extension: ".mmd",
    extensions: [".mmd", ".mermaid"],
    aliases: ["mermaid", "mmd"],
    mediaType: "text/plain",
  },
  {
    name: "drawio",
    extension: ".drawio",
    extensions: [".drawio"],
    aliases: ["drawio", "draw.io"],
    mediaType: "application/vnd.jgraph.mxfile",
  },
];

export const FORMATS = Object.freeze(Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.name, freezeDefinition(definition)]),
));

export const FORMAT_REGISTRY = new Map(Object.entries(FORMATS));
export const SUPPORTED_FORMATS = Object.freeze(Object.keys(FORMATS));

const BY_TOKEN = new Map();
for (const definition of Object.values(FORMATS)) {
  for (const token of [definition.name, ...definition.aliases, ...definition.extensions]) {
    BY_TOKEN.set(token.toLowerCase(), definition);
  }
}

export function normalizeFormat(value) {
  if (value == null || value === "") return null;
  const token = String(value).trim().toLowerCase();
  return BY_TOKEN.get(token)?.name ?? null;
}

export function getFormat(value) {
  const name = normalizeFormat(value);
  if (!name) throw new Error(`Unsupported output format: ${value}`);
  return FORMATS[name];
}

export function inferFormat(filePath) {
  if (filePath == null || filePath === "") return null;
  const extension = path.extname(String(filePath)).toLowerCase();
  return BY_TOKEN.get(extension)?.name ?? null;
}

export function inferFormatFromPath(filePath) {
  return inferFormat(filePath);
}

export function inferFormatFromExtension(extension) {
  if (extension == null || extension === "") return null;
  const token = String(extension).trim().toLowerCase();
  return BY_TOKEN.get(token.startsWith(".") ? token : `.${token}`)?.name ?? null;
}

export function resolveFormat(formatOrOptions = null, outputPath = null) {
  const options = formatOrOptions && typeof formatOrOptions === "object"
    ? formatOrOptions
    : { format: formatOrOptions, outputPath };
  const requestedValue = options.format ?? options.requestedFormat ?? options.name ?? null;
  const targetPath = options.outputPath ?? options.filePath ?? options.path ?? null;
  const strict = options.strict !== false;
  const requested = requestedValue == null ? null : normalizeFormat(requestedValue);
  const inferred = options.extension != null
    ? inferFormatFromExtension(options.extension)
    : inferFormat(targetPath);

  if (requestedValue != null && !requested) {
    throw new Error(`Unsupported output format: ${requestedValue}`);
  }
  if (!requested && !inferred) {
    throw new Error("Output format must be specified or inferred from a supported extension.");
  }
  if (strict && requested && (targetPath || options.extension != null)) {
    const extension = options.extension != null
      ? String(options.extension).toLowerCase()
      : path.extname(String(targetPath)).toLowerCase();
    if (!inferred) throw new Error(`Unsupported output extension: ${extension || "(none)"}`);
    if (requested !== inferred) {
      throw new Error(`Output format ${requested} does not match extension ${extension}.`);
    }
  }
  return FORMATS[requested ?? inferred];
}

export function assertFormatMatchesPath(format, filePath) {
  return resolveFormat({ format, outputPath: filePath, strict: true });
}

export function extensionForFormat(format) {
  return getFormat(format).extension;
}

export const resolveOutputFormat = resolveFormat;

export function hashSpec(spec) {
  return crypto.createHash("sha256").update(stableJson(spec)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    extensions: Object.freeze([...definition.extensions]),
    aliases: Object.freeze([...definition.aliases]),
  });
}
