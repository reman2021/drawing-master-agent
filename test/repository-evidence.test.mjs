import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  hasRepositoryEvidence,
  verifyRepositoryEvidence,
} from "../runtime/lib/repository-evidence.mjs";

const execFileAsync = promisify(execFile);
const authoredUrl = "https://github.com/Example/Architecture.git";

test("detects optional repository evidence", () => {
  assert.equal(hasRepositoryEvidence({ type: "architecture", nodes: [] }), false);
  assert.equal(hasRepositoryEvidence({ provenance: { repository: null } }), true);
  assert.equal(hasRepositoryEvidence({ nodes: [{ id: "api", sources: [] }] }), true);
});

test("verifies GitHub URL variants and revision-pinned blobs without modifying the repository", async (context) => {
  const repository = await createRepository(context);
  const before = await git(repository.root, ["status", "--porcelain=v1"]);
  const spec = architectureSpec(repository.revision, [
    { path: "src/api.mjs", line: 1, endLine: 2, label: "API boundary" },
    { path: "docs/design.txt", line: 1 },
  ]);

  const result = await verifyRepositoryEvidence(spec, repository.root);

  assert.deepEqual(result, {
    verified: true,
    repository: {
      url: authoredUrl,
      revision: repository.revision,
      shortRevision: repository.revision.slice(0, 12),
    },
    referenceCount: 2,
    nodes: [{
      id: "api",
      sources: [
        { path: "src/api.mjs", line: 1, endLine: 2, label: "API boundary" },
        { path: "docs/design.txt", line: 1 },
      ],
    }],
  });
  assert.equal("url" in result.nodes[0].sources[0], false);
  assert.equal("link" in result.nodes[0].sources[0], false);
  assert.equal(await git(repository.root, ["status", "--porcelain=v1"]), before);
});

test("rejects unsupported diagrams and malformed evidence with actionable diagnostics", async (context) => {
  const repository = await createRepository(context);
  const malformed = architectureSpec("short-sha", [{ path: "../secret", endLine: 0 }]);
  malformed.type = "flowchart";
  malformed.nodes[0].sources.push(
    { path: "/absolute/path" },
    { path: "src\\windows.mjs" },
    { path: "too/many" },
  );

  await assertEvidenceFailure(
    verifyRepositoryEvidence(malformed, repository.root),
    [
      "repositoryEvidence.unsupportedType",
      "repositoryEvidence.revisionInvalid",
      "repositoryEvidence.sourceCount",
    ],
  );
});

test("rejects every unsafe repository path form", async (context) => {
  const repository = await createRepository(context);
  const invalidPaths = [
    "/src/api.mjs",
    "C:/src/api.mjs",
    "src\\api.mjs",
    "src//api.mjs",
    "src/./api.mjs",
    "src/../api.mjs",
    ".git/config",
    `src/${String.fromCodePoint(1)}api.mjs`,
  ];
  for (const sourcePath of invalidPaths) {
    await assertEvidenceFailure(
      verifyRepositoryEvidence(architectureSpec(repository.revision, [{ path: sourcePath }]), repository.root),
      ["repositoryEvidence.pathInvalid"],
    );
  }
});

test("requires the Git top level and a matching origin", async (context) => {
  const repository = await createRepository(context);
  await assertEvidenceFailure(
    verifyRepositoryEvidence(
      architectureSpec(repository.revision, [{ path: "src/api.mjs" }]),
      path.join(repository.root, "src"),
    ),
    ["repositoryEvidence.repoRootNotTopLevel"],
  );

  const mismatched = architectureSpec(repository.revision, [{ path: "src/api.mjs" }]);
  mismatched.provenance.repository.url = "git@github.com:other/project.git";
  await assertEvidenceFailure(
    verifyRepositoryEvidence(mismatched, repository.root),
    ["repositoryEvidence.originMismatch"],
  );
});

test("rejects missing commits, non-blobs, missing files, and absent lines", async (context) => {
  const repository = await createRepository(context);
  await assertEvidenceFailure(
    verifyRepositoryEvidence(
      architectureSpec("f".repeat(40), [{ path: "src/api.mjs" }]),
      repository.root,
    ),
    ["repositoryEvidence.revisionUnavailable"],
  );
  await assertEvidenceFailure(
    verifyRepositoryEvidence(
      architectureSpec(repository.revision, [{ path: "src" }]),
      repository.root,
    ),
    ["repositoryEvidence.pathNotBlob"],
  );
  await assertEvidenceFailure(
    verifyRepositoryEvidence(
      architectureSpec(repository.revision, [{ path: "src/missing.mjs" }]),
      repository.root,
    ),
    ["repositoryEvidence.pathMissing"],
  );
  await assertEvidenceFailure(
    verifyRepositoryEvidence(
      architectureSpec(repository.revision, [{ path: "src/api.mjs", line: 4 }]),
      repository.root,
    ),
    ["repositoryEvidence.lineMissing"],
  );
});

test("validates source counts, ranges, labels, and at least one declared source", async (context) => {
  const repository = await createRepository(context);
  const cases = [
    [{ ...architectureSpec(repository.revision, []).nodes[0], sources: [] }, "repositoryEvidence.sourceCount"],
    [{ id: "api" }, "repositoryEvidence.sourcesMissing"],
    [{ id: "api", sources: [{ path: "src/api.mjs", line: 0 }] }, "repositoryEvidence.lineInvalid"],
    [{ id: "api", sources: [{ path: "src/api.mjs", endLine: 1 }] }, "repositoryEvidence.lineRequired"],
    [{ id: "api", sources: [{ path: "src/api.mjs", line: 2, endLine: 1 }] }, "repositoryEvidence.lineRangeInvalid"],
    [{ id: "api", sources: [{ path: "src/api.mjs", label: "bad\nlabel" }] }, "repositoryEvidence.labelInvalid"],
  ];
  for (const [node, expectedCode] of cases) {
    const spec = architectureSpec(repository.revision, [{ path: "src/api.mjs" }]);
    spec.nodes = [node];
    await assertEvidenceFailure(verifyRepositoryEvidence(spec, repository.root), [expectedCode]);
  }
});

async function createRepository(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-evidence-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Drawing Master Test"]);
  await git(root, ["config", "user.email", "drawing-master@example.invalid"]);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "api.mjs"), "export const api = true;\nexport const port = 443;\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "design.txt"), "Architecture evidence\n", "utf8");
  await git(root, ["add", "src/api.mjs", "docs/design.txt"]);
  await git(root, ["commit", "-m", "Add architecture sources"]);
  const revision = await git(root, ["rev-parse", "HEAD"]);
  await fs.writeFile(path.join(root, "src", "api.mjs"), "export const currentHead = true;\n", "utf8");
  await git(root, ["add", "src/api.mjs"]);
  await git(root, ["commit", "-m", "Change current architecture source"]);
  await git(root, ["remote", "add", "origin", "git@github.com:example/architecture.git"]);
  return { root, revision };
}

function architectureSpec(revision, sources) {
  return {
    schemaVersion: 1,
    documentId: "repository-evidence",
    title: "Repository evidence",
    type: "architecture",
    provenance: { repository: { url: authoredUrl, revision } },
    nodes: [{ id: "api", label: "API", sources }],
    edges: [],
  };
}

async function assertEvidenceFailure(promise, expectedCodes) {
  await assert.rejects(promise, (error) => {
    assert.equal(typeof error.code, "string");
    assert.ok(Array.isArray(error.details?.diagnostics));
    const codes = error.details.diagnostics.map((item) => item.code);
    for (const expectedCode of expectedCodes) assert.ok(codes.includes(expectedCode), `${expectedCode} not in ${codes}`);
    for (const item of error.details.diagnostics) {
      assert.equal(typeof item.subject, "string");
      assert.ok(item.evidence && typeof item.evidence === "object");
      assert.ok(Array.isArray(item.supportedFixes) && item.supportedFixes.length > 0);
    }
    return true;
  });
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    windowsHide: true,
  });
  return stdout.trim();
}
