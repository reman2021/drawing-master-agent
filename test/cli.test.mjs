import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "runtime", "cli.mjs");
const fixture = path.join(root, "fixtures", "specs", "flowchart.json");

test("CLI compiles, refuses implicit overwrite, validates and updates with backup", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-cli-"));
  const output = path.join(workspace, "login.excalidraw");
  const first = run(["compile", fixture, output, "--workspace", workspace]);
  assert.equal(first.status, 0, first.stderr);
  const compiled = JSON.parse(first.stdout);
  assert.ok(compiled.quality.valid);
  const source = await fs.readFile(output);
  assert.equal(compiled.outputs[0].sha256, crypto.createHash("sha256").update(source).digest("hex"));
  assert.equal(compiled.outputs[0].bytes, source.byteLength);

  const refused = run(["compile", fixture, output, "--workspace", workspace]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Refusing to overwrite/u);

  const validated = run(["validate", output]);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).valid, true);

  const update = run(["update", output, fixture, "--workspace", workspace]);
  assert.equal(update.status, 0, update.stderr);
  const result = JSON.parse(update.stdout);
  assert.ok(result.backupPath);
  await fs.access(result.backupPath);
  await fs.access(path.join(workspace, ".drawing-master", "manifest.json"));
});

test("CLI rejects corrupted source without changing it", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-corrupt-"));
  const source = path.join(workspace, "broken.excalidraw");
  await fs.writeFile(source, "{broken", "utf8");
  const before = await fs.readFile(source, "utf8");
  const result = run(["update", source, fixture, "--workspace", workspace]);
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(source, "utf8"), before);
});

test("CLI requires a format and rejects extension mismatches", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-format-"));
  const missing = run(["compile", fixture, "--workspace", workspace]);
  assert.notEqual(missing.status, 0);
  assert.equal(JSON.parse(missing.stderr).code, "format.required");

  const mismatch = run([
    "compile",
    fixture,
    path.join(workspace, "wrong.drawio"),
    "--format",
    "mermaid",
  ]);
  assert.notEqual(mismatch.status, 0);
  assert.equal(JSON.parse(mismatch.stderr).code, "format.extensionMismatch");
});

test("CLI compiles multiple formats with one stem and records manifest v2", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-multi-"));
  const result = run([
    "compile",
    fixture,
    "--format",
    "mermaid",
    "--format",
    "draw.io",
    "--workspace",
    workspace,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.outputs.length, 2);
  const stems = output.outputs.map((item) => path.basename(item.path, path.extname(item.path)));
  assert.equal(new Set(stems).size, 1);
  for (const item of output.outputs) await fs.access(item.path);

  const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".drawing-master", "manifest.json"), "utf8"));
  assert.equal(manifest.manifestVersion, 2);
  const document = manifest.documents["fixture-login-flow"];
  assert.deepEqual(Object.keys(document.artifacts).sort(), ["drawio", "mermaid"]);
  assert.match(document.specHash, /^[0-9a-f]{64}$/u);
  assert.match(document.artifacts.mermaid.artifactHash, /^[0-9a-f]{64}$/u);
});

test("sync blocks modified artifacts, then overwrites with backups when authorized", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-sync-"));
  const compiled = run([
    "compile",
    fixture,
    "--format",
    "mermaid",
    "--format",
    "drawio",
    "--workspace",
    workspace,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const outputs = JSON.parse(compiled.stdout).outputs;
  const mermaid = outputs.find((item) => item.format === "mermaid").path;
  const drawio = outputs.find((item) => item.format === "drawio").path;
  const drawioBefore = await fs.readFile(drawio, "utf8");
  await fs.appendFile(mermaid, "%% manual change\n", "utf8");

  const updatedSpec = JSON.parse(await fs.readFile(fixture, "utf8"));
  updatedSpec.nodes[1].label = "输入新凭证";
  const updatedSpecPath = path.join(workspace, "updated-spec.json");
  await fs.writeFile(updatedSpecPath, `${JSON.stringify(updatedSpec, null, 2)}\n`, "utf8");

  const blocked = run(["sync", updatedSpecPath, "--workspace", workspace]);
  assert.notEqual(blocked.status, 0);
  assert.equal(JSON.parse(blocked.stderr).code, "artifact.modified");
  assert.equal(await fs.readFile(drawio, "utf8"), drawioBefore);

  const synchronized = run([
    "sync",
    updatedSpecPath,
    "--workspace",
    workspace,
    "--conflict",
    "overwrite",
  ]);
  assert.equal(synchronized.status, 0, synchronized.stderr);
  const result = JSON.parse(synchronized.stdout);
  assert.equal(result.outputs.length, 2);
  assert.equal(result.backupPaths.length, 2);
  assert.match(await fs.readFile(mermaid, "utf8"), /输入新凭证/u);
});

test("sync can detach a missing managed artifact without recreating it", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-detach-"));
  const compiled = run([
    "compile",
    fixture,
    "--format",
    "mermaid",
    "--format",
    "drawio",
    "--workspace",
    workspace,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const outputs = JSON.parse(compiled.stdout).outputs;
  const drawio = outputs.find((item) => item.format === "drawio").path;
  await fs.rm(drawio);

  const result = run([
    "sync",
    fixture,
    "--workspace",
    workspace,
    "--missing",
    "detach",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).detachedFormats, ["drawio"]);
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".drawing-master", "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.documents["fixture-login-flow"].artifacts), ["mermaid"]);
  await assert.rejects(fs.access(drawio));
});

test("sync can detach the only missing artifact", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-detach-only-"));
  const compiled = run(["compile", fixture, "--format", "mermaid", "--workspace", workspace]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const artifact = JSON.parse(compiled.stdout).output;
  await fs.rm(artifact);
  const detached = run(["sync", fixture, "--workspace", workspace, "--missing", "detach"]);
  assert.equal(detached.status, 0, detached.stderr);
  assert.deepEqual(JSON.parse(detached.stdout).outputs, []);
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".drawing-master", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.documents["fixture-login-flow"].artifacts, {});
});

test("sync can update selected formats and leaves the others stale", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-selective-"));
  const compiled = run([
    "compile",
    fixture,
    "--format",
    "excalidraw",
    "--format",
    "mermaid",
    "--format",
    "drawio",
    "--workspace",
    workspace,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const outputs = JSON.parse(compiled.stdout).outputs;
  const drawioPath = outputs.find((item) => item.format === "drawio").path;
  const drawioBefore = await fs.readFile(drawioPath, "utf8");
  await fs.appendFile(drawioPath, "\n<!-- manual -->\n", "utf8");

  const updated = JSON.parse(await fs.readFile(fixture, "utf8"));
  updated.nodes[1].label = "仅更新 Mermaid";
  const updatedPath = path.join(workspace, "updated.json");
  await fs.writeFile(updatedPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  const synchronized = run([
    "sync",
    updatedPath,
    "--format",
    "mermaid",
    "--workspace",
    workspace,
  ]);
  assert.equal(synchronized.status, 0, synchronized.stderr);
  const result = JSON.parse(synchronized.stdout);
  assert.deepEqual(result.selectedFormats, ["mermaid"]);
  assert.deepEqual(result.staleFormats.sort(), ["drawio", "excalidraw"]);
  assert.deepEqual(result.outputs.map((item) => item.format), ["mermaid"]);
  assert.equal(await fs.readFile(drawioPath, "utf8"), `${drawioBefore}\n<!-- manual -->\n`);

  const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".drawing-master", "manifest.json"), "utf8"));
  const document = manifest.documents["fixture-login-flow"];
  assert.equal(document.artifacts.mermaid.specHash, document.specHash);
  assert.notEqual(document.artifacts.drawio.specHash, document.specHash);
  assert.notEqual(document.artifacts.excalidraw.specHash, document.specHash);
});

test("recover rebuilds a missing manifest only from matching embedded identities", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-recover-"));
  const compiled = run([
    "compile",
    fixture,
    "--format",
    "excalidraw",
    "--format",
    "mermaid",
    "--format",
    "drawio",
    "--workspace",
    workspace,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const outputs = JSON.parse(compiled.stdout).outputs;
  await fs.rm(path.join(workspace, ".drawing-master"), { recursive: true, force: true });

  const recovered = run([
    "recover",
    fixture,
    ...outputs.map((item) => item.path),
    "--workspace",
    workspace,
  ]);
  assert.equal(recovered.status, 0, recovered.stderr);
  const result = JSON.parse(recovered.stdout);
  assert.equal(result.recovered, true);
  assert.deepEqual(result.outputs.map((item) => item.format).sort(), ["drawio", "excalidraw", "mermaid"]);
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".drawing-master", "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.documents["fixture-login-flow"].artifacts).sort(), ["drawio", "excalidraw", "mermaid"]);

  await fs.rm(path.join(workspace, ".drawing-master"), { recursive: true, force: true });
  const changed = JSON.parse(await fs.readFile(fixture, "utf8"));
  changed.nodes[0].label = "身份不匹配";
  const changedPath = path.join(workspace, "changed.json");
  await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const rejected = run(["recover", changedPath, outputs[0].path, "--workspace", workspace]);
  assert.notEqual(rejected.status, 0);
  assert.equal(JSON.parse(rejected.stderr).code, "artifact.identityMismatch");
  await assert.rejects(fs.access(path.join(workspace, ".drawing-master", "manifest.json")));
});

test("legacy manifests require conflict confirmation before first sync", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-legacy-conflict-"));
  const compiled = run(["compile", fixture, "--format", "excalidraw", "--workspace", workspace]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const output = JSON.parse(compiled.stdout).output;
  const manifestPath = path.join(workspace, ".drawing-master", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const document = manifest.documents["fixture-login-flow"];
  const legacy = {
    manifestVersion: 1,
    documents: {
      "fixture-login-flow": {
        documentId: "fixture-login-flow",
        path: document.artifacts.excalidraw.path,
        specPath: document.specPath,
        schemaVersion: 1,
        compiledAt: document.artifacts.excalidraw.compiledAt,
      },
    },
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const artifact = JSON.parse(await fs.readFile(output, "utf8"));
  artifact.appState.manualLegacyChange = true;
  await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const synchronized = run(["sync", fixture, "--workspace", workspace]);
  assert.notEqual(synchronized.status, 0);
  assert.equal(JSON.parse(synchronized.stderr).code, "artifact.modified");
  assert.equal(JSON.parse(await fs.readFile(output, "utf8")).appState.manualLegacyChange, true);
});

test("compile rolls back artifacts when workspace state cannot be committed", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-transaction-"));
  await fs.mkdir(path.join(workspace, ".drawing-master", "manifest.json"), { recursive: true });
  const result = run(["compile", fixture, "--format", "mermaid", "--workspace", workspace]);
  assert.notEqual(result.status, 0);
  const drawings = path.join(workspace, "drawings");
  await assert.rejects(fs.access(drawings));
});

test("adding a format reuses the managed document stem", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-stem-"));
  const occupied = path.join(workspace, "drawings");
  await fs.mkdir(occupied, { recursive: true });
  await fs.writeFile(path.join(occupied, "用户登录流程.excalidraw"), "occupied", "utf8");
  const first = run(["compile", fixture, "--format", "excalidraw", "--workspace", workspace]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(path.basename(JSON.parse(first.stdout).output), "用户登录流程-2.excalidraw");
  const second = run(["compile", fixture, "--format", "mermaid", "--workspace", workspace]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(path.basename(JSON.parse(second.stdout).output), "用户登录流程-2.mmd");
});

test("check is read-only, supports quality profiles, and guide is deterministic", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-check-"));
  const specPath = path.join(workspace, "spec.json");
  await fs.copyFile(fixture, specPath);

  const checked = run(["check", specPath, "--format", "mermaid"]);
  assert.equal(checked.status, 0, checked.stderr);
  const result = JSON.parse(checked.stdout);
  assert.equal(result.command, "check");
  assert.equal(result.valid, true);
  assert.equal(result.qualityProfile, "standard");
  assert.match(result.specHash, /^[0-9a-f]{64}$/u);
  await assert.rejects(fs.access(path.join(workspace, ".drawing-master")));
  await assert.rejects(fs.access(path.join(workspace, "drawings")));

  const showcaseSpec = JSON.parse(await fs.readFile(specPath, "utf8"));
  showcaseSpec.nodes[0].position = { x: 0, y: 0 };
  showcaseSpec.nodes[1].position = { x: 0, y: 0 };
  const showcaseSpecPath = path.join(workspace, "showcase-spec.json");
  await fs.writeFile(showcaseSpecPath, `${JSON.stringify(showcaseSpec, null, 2)}\n`, "utf8");
  const showcase = run(["check", showcaseSpecPath, "--format", "mermaid", "--quality", "showcase"]);
  assert.notEqual(showcase.status, 0);
  const showcaseResult = JSON.parse(showcase.stdout);
  assert.equal(showcaseResult.valid, false);
  assert.ok(showcaseResult.diagnostics.some((item) => item.code === "geometry.nodeOverlap" && item.severity === "error"));
  for (const diagnostic of showcaseResult.diagnostics) {
    for (const field of ["code", "severity", "message", "subject", "evidence", "supportedFixes"]) {
      assert.ok(field in diagnostic, `${field} missing from diagnostic`);
    }
  }

  const guide = run(["guide", "system", "components", "and", "service", "boundaries"]);
  assert.equal(guide.status, 0, guide.stderr);
  assert.equal(JSON.parse(guide.stdout).recommendation.type, "architecture");
});

test("check integrates repository evidence failures without writing artifacts", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-check-evidence-"));
  const specPath = path.join(workspace, "architecture.json");
  const spec = {
    schemaVersion: 2,
    documentId: "evidence-check",
    title: "Evidence check",
    type: "architecture",
    provenance: { repository: { url: "https://github.com/example/project.git", revision: "a".repeat(40) } },
    nodes: [{ id: "api", label: "API", kind: "component", sources: [{ path: "src/api.mjs", line: 1 }] }],
    edges: [],
  };
  await fs.writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  const checked = run(["check", specPath, "--format", "mermaid", "--repo", workspace]);
  assert.notEqual(checked.status, 0);
  const result = JSON.parse(checked.stdout);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.code === "repositoryEvidence.repoRootNotGit"));
  await assert.rejects(fs.access(path.join(workspace, ".drawing-master")));
  await assert.rejects(fs.access(path.join(workspace, "drawings")));
});

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
