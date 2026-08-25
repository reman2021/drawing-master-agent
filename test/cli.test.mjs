import assert from "node:assert/strict";
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
  assert.ok(JSON.parse(first.stdout).quality.valid);

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

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
