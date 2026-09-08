import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FULL_REVISION = /^[0-9a-f]{40}$/iu;
const CONTROL_CHARACTER = /\p{Cc}/u;
const SHORT_REVISION_LENGTH = 12;

export function hasRepositoryEvidence(spec) {
  if (!spec || typeof spec !== "object") return false;
  const provenance = spec.provenance;
  if (provenance && typeof provenance === "object"
    && Object.prototype.hasOwnProperty.call(provenance, "repository")) {
    return true;
  }
  return Array.isArray(spec.nodes)
    && spec.nodes.some((node) => node && typeof node === "object"
      && Object.prototype.hasOwnProperty.call(node, "sources"));
}

export async function verifyRepositoryEvidence(spec, repoRoot) {
  try {
    return await verify(spec, repoRoot);
  } catch (error) {
    if (Array.isArray(error?.details?.diagnostics)) throw error;
    throw failure([diagnostic(
      "repositoryEvidence.internal",
      "Repository evidence verification could not be completed.",
      "repository",
      { reason: error?.message ?? String(error) },
      ["Check that Git is installed and that the local repository is readable."],
    )]);
  }
}

async function verify(spec, repoRoot) {
  const validated = validateEvidenceSpec(spec);
  const root = await validateRepositoryRoot(repoRoot);
  const diagnostics = [];

  let origin;
  try {
    origin = await gitText(root, ["remote", "get-url", "origin"]);
  } catch (error) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.originMissing",
      "The local repository must have an origin remote.",
      "repository.origin",
      gitFailureEvidence(error),
      ["Configure origin to match provenance.repository.url."],
    ));
  }

  if (origin) {
    let normalizedOrigin;
    try {
      normalizedOrigin = normalizeRepositoryUrl(origin);
    } catch {
      diagnostics.push(diagnostic(
        "repositoryEvidence.originInvalid",
        "The origin remote is not a supported repository URL.",
        "repository.origin",
        { actual: origin },
        ["Use an HTTPS or SSH repository URL for origin."],
      ));
    }
    if (normalizedOrigin && normalizedOrigin !== validated.normalizedUrl) {
      diagnostics.push(diagnostic(
        "repositoryEvidence.originMismatch",
        "The origin remote does not match provenance.repository.url.",
        "repository.origin",
        { authored: validated.repository.url, actual: origin },
        ["Use the intended local repository or correct provenance.repository.url."],
      ));
    }
  }

  let revisionExists = false;
  try {
    const objectType = await gitText(root, ["cat-file", "-t", validated.repository.revision]);
    if (objectType !== "commit") {
      diagnostics.push(diagnostic(
        "repositoryEvidence.revisionNotCommit",
        "provenance.repository.revision must identify a commit object.",
        "repository.revision",
        { revision: validated.repository.revision, objectType },
        ["Pin provenance.repository.revision to the full SHA of a local commit."],
      ));
    } else {
      revisionExists = true;
    }
  } catch (error) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.revisionUnavailable",
      "The pinned revision does not exist in the local repository.",
      "repository.revision",
      { revision: validated.repository.revision, ...gitFailureEvidence(error) },
      ["Fetch the commit separately, then retry without network access from this verifier."],
    ));
  }

  if (revisionExists) {
    const inspected = new Map();
    for (const node of validated.nodes) {
      for (const source of node.sources) {
        let blob = inspected.get(source.path);
        if (!blob) {
          blob = await inspectRevisionPath(root, validated.repository.revision, source.path);
          inspected.set(source.path, blob);
        }
        if (blob.diagnostic) {
          diagnostics.push({
            ...blob.diagnostic,
            subject: `${node.subject}.sources[${source.index}].path`,
          });
          continue;
        }
        if (source.line != null || source.endLine != null) {
          const lastRequestedLine = source.endLine ?? source.line;
          if (lastRequestedLine > blob.lineCount) {
            diagnostics.push(diagnostic(
              "repositoryEvidence.lineMissing",
              "The referenced line range does not exist in the pinned blob.",
              `${node.subject}.sources[${source.index}]`,
              {
                path: source.path,
                requestedLine: source.line,
                requestedEndLine: source.endLine ?? source.line,
                availableLines: blob.lineCount,
              },
              ["Choose a line range present at the pinned revision or update the pinned revision."],
            ));
          }
        }
      }
    }
  }

  if (diagnostics.length > 0) throw failure(diagnostics);
  return {
    verified: true,
    repository: {
      url: validated.repository.url,
      revision: validated.repository.revision,
      shortRevision: validated.repository.revision.slice(0, SHORT_REVISION_LENGTH),
    },
    referenceCount: validated.nodes.reduce((count, node) => count + node.sources.length, 0),
    nodes: validated.nodes.map((node) => ({
      id: node.id,
      sources: node.sources.map(({ index, ...source }) => ({ ...source })),
    })),
  };
}

function validateEvidenceSpec(spec) {
  const diagnostics = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.specInvalid",
      "DiagramSpec must be an object.",
      "spec",
      { actualType: typeOf(spec) },
      ["Pass an architecture DiagramSpec object."],
    ));
    throw failure(diagnostics);
  }
  if (spec.type !== "architecture") {
    diagnostics.push(diagnostic(
      "repositoryEvidence.unsupportedType",
      "Repository evidence is supported only for architecture diagrams.",
      "spec.type",
      { actual: spec.type },
      ["Set type to architecture or remove repository evidence."],
    ));
  }

  const repository = spec.provenance?.repository;
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.repositoryMissing",
      "spec.provenance.repository must be an object with url and revision.",
      "spec.provenance.repository",
      { actualType: typeOf(repository) },
      ["Provide provenance.repository.url and a full 40-character commit SHA."],
    ));
  }

  let normalizedUrl;
  if (repository && typeof repository === "object" && !Array.isArray(repository)) {
    if (typeof repository.url !== "string" || repository.url.length === 0) {
      diagnostics.push(diagnostic(
        "repositoryEvidence.urlInvalid",
        "provenance.repository.url must be a non-empty repository URL.",
        "spec.provenance.repository.url",
        { actualType: typeOf(repository.url) },
        ["Provide the repository HTTPS or SSH URL."],
      ));
    } else {
      try {
        normalizedUrl = normalizeRepositoryUrl(repository.url);
      } catch (error) {
        diagnostics.push(diagnostic(
          "repositoryEvidence.urlInvalid",
          "provenance.repository.url is not a supported repository URL.",
          "spec.provenance.repository.url",
          { reason: error.message },
          ["Use an HTTPS or SSH repository URL without query parameters or fragments."],
        ));
      }
    }
    if (typeof repository.revision !== "string" || !FULL_REVISION.test(repository.revision)) {
      diagnostics.push(diagnostic(
        "repositoryEvidence.revisionInvalid",
        "provenance.repository.revision must be a full 40-character SHA.",
        "spec.provenance.repository.revision",
        { actual: repository.revision },
        ["Replace the revision with the full hexadecimal commit SHA."],
      ));
    }
  }

  const nodes = [];
  let declaredSources = 0;
  if (!Array.isArray(spec.nodes)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.nodesInvalid",
      "spec.nodes must be an array.",
      "spec.nodes",
      { actualType: typeOf(spec.nodes) },
      ["Provide architecture nodes with source references."],
    ));
  } else {
    for (let nodeIndex = 0; nodeIndex < spec.nodes.length; nodeIndex += 1) {
      const node = spec.nodes[nodeIndex];
      if (!node || typeof node !== "object" || Array.isArray(node)
        || !Object.prototype.hasOwnProperty.call(node, "sources")) continue;
      declaredSources += 1;
      const subject = `spec.nodes[${nodeIndex}]`;
      const id = typeof node.id === "string" && node.id.length > 0 ? node.id : `node-${nodeIndex + 1}`;
      if (!Array.isArray(node.sources) || node.sources.length < 1 || node.sources.length > 3) {
        diagnostics.push(diagnostic(
          "repositoryEvidence.sourceCount",
          "A node sources field must contain between one and three references.",
          `${subject}.sources`,
          { actualCount: Array.isArray(node.sources) ? node.sources.length : null },
          ["Provide one to three source references or remove the sources field."],
        ));
        continue;
      }
      const sources = [];
      for (let sourceIndex = 0; sourceIndex < node.sources.length; sourceIndex += 1) {
        const source = validateSource(node.sources[sourceIndex], subject, sourceIndex, diagnostics);
        if (source) sources.push(source);
      }
      if (sources.length === node.sources.length) nodes.push({ id, subject, sources });
    }
  }
  if (declaredSources === 0) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.sourcesMissing",
      "At least one architecture node must declare source references.",
      "spec.nodes",
      { referenceCount: 0 },
      ["Add a sources array with one to three references to an architecture node."],
    ));
  }

  if (diagnostics.length > 0) throw failure(diagnostics);
  return {
    repository: {
      url: repository.url,
      revision: repository.revision.toLowerCase(),
    },
    normalizedUrl,
    nodes,
  };
}

function validateSource(input, nodeSubject, index, diagnostics) {
  const subject = `${nodeSubject}.sources[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.sourceInvalid",
      "Each source reference must be an object.",
      subject,
      { actualType: typeOf(input) },
      ["Provide a source object containing a repository-relative POSIX path."],
    ));
    return null;
  }

  if (!validRepositoryPath(input.path)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.pathInvalid",
      "Source path must be a safe repository-relative POSIX path.",
      `${subject}.path`,
      { actual: input.path },
      ["Use slash-separated path segments without empty, dot, dot-dot, or .git segments."],
    ));
  }

  const hasLine = Object.prototype.hasOwnProperty.call(input, "line");
  const hasEndLine = Object.prototype.hasOwnProperty.call(input, "endLine");
  if (hasLine && !positiveInteger(input.line)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.lineInvalid",
      "source.line must be a positive integer.",
      `${subject}.line`,
      { actual: input.line },
      ["Use a one-based positive line number."],
    ));
  }
  if (hasEndLine && !positiveInteger(input.endLine)) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.endLineInvalid",
      "source.endLine must be a positive integer.",
      `${subject}.endLine`,
      { actual: input.endLine },
      ["Use a one-based positive ending line number."],
    ));
  }
  if (hasEndLine && !hasLine) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.lineRequired",
      "source.endLine requires source.line.",
      `${subject}.endLine`,
      { endLine: input.endLine },
      ["Add the starting line or remove endLine."],
    ));
  }
  if (positiveInteger(input.line) && positiveInteger(input.endLine) && input.endLine < input.line) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.lineRangeInvalid",
      "source.endLine must not be less than source.line.",
      subject,
      { line: input.line, endLine: input.endLine },
      ["Use an endLine greater than or equal to line."],
    ));
  }
  if (Object.prototype.hasOwnProperty.call(input, "label")
    && (typeof input.label !== "string" || input.label.length === 0 || CONTROL_CHARACTER.test(input.label))) {
    diagnostics.push(diagnostic(
      "repositoryEvidence.labelInvalid",
      "source.label must be a non-empty string without control characters.",
      `${subject}.label`,
      { actualType: typeOf(input.label) },
      ["Use a plain-text label or remove the label."],
    ));
  }

  const invalid = diagnostics.some((item) => item.subject === subject || item.subject.startsWith(`${subject}.`));
  if (invalid) return null;
  return {
    path: input.path,
    ...(hasLine ? { line: input.line } : {}),
    ...(hasEndLine ? { endLine: input.endLine } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "label") ? { label: input.label } : {}),
    index,
  };
}

async function validateRepositoryRoot(repoRoot) {
  let root;
  try {
    if (typeof repoRoot !== "string" || repoRoot.length === 0 || CONTROL_CHARACTER.test(repoRoot)) {
      throw new Error("repoRoot must be a non-empty path string.");
    }
    root = await fs.realpath(path.resolve(repoRoot));
  } catch (error) {
    throw failure([diagnostic(
      "repositoryEvidence.repoRootInvalid",
      "repoRoot must identify a readable local directory.",
      "repoRoot",
      { reason: error.message },
      ["Pass the top-level directory of the local Git repository."],
    )]);
  }

  let topLevel;
  try {
    topLevel = await gitText(root, ["rev-parse", "--show-toplevel"]);
    topLevel = await fs.realpath(topLevel);
  } catch (error) {
    throw failure([diagnostic(
      "repositoryEvidence.repoRootNotGit",
      "repoRoot is not the top level of a non-bare Git working tree.",
      "repoRoot",
      { path: root, ...gitFailureEvidence(error) },
      ["Pass the repository top-level working directory."],
    )]);
  }
  if (!samePath(root, topLevel)) {
    throw failure([diagnostic(
      "repositoryEvidence.repoRootNotTopLevel",
      "repoRoot must be the Git top-level working directory.",
      "repoRoot",
      { actual: root, expected: topLevel },
      ["Pass the path returned by git rev-parse --show-toplevel."],
    )]);
  }
  return root;
}

async function inspectRevisionPath(root, revision, sourcePath) {
  const objectExpression = `${revision}:${sourcePath}`;
  let objectType;
  try {
    objectType = await gitText(root, ["cat-file", "-t", objectExpression]);
  } catch (error) {
    return { diagnostic: diagnostic(
      "repositoryEvidence.pathMissing",
      "The source path does not exist at the pinned revision.",
      "source.path",
      { path: sourcePath, revision, ...gitFailureEvidence(error) },
      ["Use a path present at the pinned revision or update the pinned revision."],
    ) };
  }
  if (objectType !== "blob") {
    return { diagnostic: diagnostic(
      "repositoryEvidence.pathNotBlob",
      "The source path must identify a blob at the pinned revision.",
      "source.path",
      { path: sourcePath, revision, objectType },
      ["Reference a file rather than a directory or submodule."],
    ) };
  }

  try {
    const contents = await gitBuffer(root, ["cat-file", "blob", objectExpression]);
    return { lineCount: countLines(contents) };
  } catch (error) {
    return { diagnostic: diagnostic(
      "repositoryEvidence.blobUnreadable",
      "The pinned source blob could not be read.",
      "source.path",
      { path: sourcePath, revision, ...gitFailureEvidence(error) },
      ["Check the local Git object database and retry."],
    ) };
  }
}

async function gitText(root, args) {
  const { stdout } = await runGit(root, args, "utf8");
  return stdout.trim();
}

async function gitBuffer(root, args) {
  const { stdout } = await runGit(root, args, null);
  return stdout;
}

function runGit(root, args, encoding) {
  return execFileAsync("git", [
    "-c",
    "protocol.allow=never",
    "--no-replace-objects",
    "-C",
    root,
    ...args,
  ], {
    encoding,
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
}

function normalizeRepositoryUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || CONTROL_CHARACTER.test(value)) {
    throw new Error("Repository URL must be non-empty and contain no surrounding whitespace or control characters.");
  }

  const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u.exec(value);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    return canonicalRepository(scp[1], "", scp[2]);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Repository URL must use HTTPS or SSH syntax.");
  }
  if (!["https:", "ssh:"].includes(parsed.protocol) || parsed.search || parsed.hash) {
    throw new Error("Repository URL must use HTTPS or SSH and must not contain a query or fragment.");
  }
  return canonicalRepository(parsed.hostname, parsed.port, parsed.pathname);
}

function canonicalRepository(hostname, port, repositoryPath) {
  let pathname = repositoryPath.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  if (!hostname || !pathname || pathname.split("/").some((segment) => segment.length === 0)) {
    throw new Error("Repository URL must contain a host and repository path.");
  }
  const host = hostname.toLowerCase();
  if (host === "github.com") {
    const segments = pathname.split("/");
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
      throw new Error("GitHub repository URL must contain owner and repository names.");
    }
    pathname = pathname.toLowerCase();
    port = ["", "22", "443"].includes(port) ? "" : port;
  }
  return `${host}${port ? `:${port}` : ""}/${pathname}`;
}

function validRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTER.test(value)
    || value.includes("\\") || path.posix.isAbsolute(value) || /^[a-z]:\//iu.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return !segments.some((segment) => segment.length === 0
    || segment === "."
    || segment === ".."
    || segment.toLowerCase() === ".git");
}

function countLines(buffer) {
  if (buffer.length === 0) return 0;
  let lines = 0;
  for (const byte of buffer) if (byte === 0x0a) lines += 1;
  return lines + (buffer[buffer.length - 1] === 0x0a ? 0 : 1);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function gitFailureEvidence(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : error?.stderr;
  return {
    exitCode: Number.isInteger(error?.code) ? error.code : null,
    reason: String(stderr || error?.message || "Git command failed.").trim(),
  };
}

function diagnostic(code, message, subject, evidence, supportedFixes) {
  return { code, severity: "error", message, subject, evidence, supportedFixes };
}

function failure(diagnostics) {
  const error = new Error(diagnostics.length === 1
    ? diagnostics[0].message
    : `Repository evidence verification failed with ${diagnostics.length} diagnostics.`);
  error.name = "RepositoryEvidenceError";
  error.code = diagnostics.length === 1 ? diagnostics[0].code : "repositoryEvidence.invalid";
  error.details = { diagnostics };
  return error;
}

function typeOf(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}
