import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installScript = path.join(root, "scripts", "install.mjs");
const uninstallScript = path.join(root, "scripts", "uninstall.mjs");
const packageScript = path.join(root, "scripts", "package.mjs");

test("installer is idempotent and uninstaller preserves unrelated global rules", async () => {
  const config = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-install-"));
  const rulesPath = path.join(config, "AGENTS.md");
  await fs.writeFile(rulesPath, "# Existing rules\n\nKeep this rule.\n", "utf8");

  const first = runNode(installScript, ["--config", config]);
  assert.equal(first.status, 0, first.stderr);
  await fs.access(path.join(config, "agents", "drawing-master.md"));
  await fs.access(path.join(config, "drawing-master", "cli.mjs"));

  const second = runNode(installScript, ["--config", config]);
  assert.equal(second.status, 0, second.stderr);
  const installedRules = await fs.readFile(rulesPath, "utf8");
  assert.equal(count(installedRules, "<!-- drawing-master-routing:start -->"), 1);
  assert.match(installedRules, /Keep this rule\./u);
  assert.match(installedRules, /Mermaid、draw\.io/u);
  assert.match(installedRules, /不得默认格式/u);
  const installedAgent = await fs.readFile(path.join(config, "agents", "drawing-master.md"), "utf8");
  assert.match(installedAgent, /允许多选/u);
  assert.match(installedAgent, /artifact\.modified/u);
  for (const contract of [
    /禁止手写最终格式产物/u,
    /必须通过对应质量门/u,
    /artifact\.missing/u,
    /保留无关元素、未知字段、位置、尺寸和样式/u,
    /外部 Mermaid 和 draw\.io 仅校验安全子集/u,
    /不扩写用户未提供的业务内容/u,
    /不声称生成 PNG 或 SVG/u,
    /不得绕过编译器/u,
    /DiagramSpec v2/u,
    /只读 `check`/u,
    /SHA-256/u,
    /源码证据已验证/u,
    /sync.*--format/u,
    /recover/u,
    /`stale`/u,
  ]) {
    assert.match(installedAgent, contract);
  }
  assert.doesNotMatch(installedAgent, /## 输出示例/u);

  const uninstalled = runNode(uninstallScript, ["--config", config]);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  await assert.rejects(fs.access(path.join(config, "agents", "drawing-master.md")));
  await assert.rejects(fs.access(path.join(config, "drawing-master")));
  const remainingRules = await fs.readFile(rulesPath, "utf8");
  assert.doesNotMatch(remainingRules, /drawing-master-routing/u);
  assert.match(remainingRules, /Keep this rule\./u);

  const entries = await fs.readdir(config);
  assert.ok(entries.some((entry) => entry.startsWith("drawing-master.uninstalled-")));
});

test("release package uses an allowlist and publishes checksums", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "drawing-master-package-"));
  const packaged = runNode(packageScript, ["--output", output]);
  assert.equal(packaged.status, 0, packaged.stderr);

  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const releaseName = `drawing-master-agent-v${packageJson.version}`;
  const archive = path.join(output, `${releaseName}.tar.gz`);
  const checksums = await fs.readFile(path.join(output, "SHA256SUMS.txt"), "utf8");
  await fs.access(archive);
  assert.match(checksums, new RegExp(`${releaseName}\\.tar\\.gz`, "u"));

  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, new RegExp(`${releaseName}/\\.opencode/agents/drawing-master\\.md`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/runtime/lib/mermaid\\.mjs`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/runtime/lib/drawio\\.mjs`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/runtime/lib/diagnostics\\.mjs`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/runtime/lib/schema-validator\\.mjs`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/runtime/schemas/diagram-spec-v2\\.schema\\.json`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/fixtures/mermaid/flowchart\\.mmd`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/fixtures/drawio/flowchart\\.drawio`, "u"));
  assert.match(listing.stdout, new RegExp(`${releaseName}/LICENSE`, "u"));
  assert.doesNotMatch(listing.stdout, /(?:ARCHIFY-ADOPTION|DRAWING-MASTER)-PLAN\.md/u);
  assert.doesNotMatch(listing.stdout, /node_modules/u);
  assert.doesNotMatch(listing.stdout, /\.drawing-master/u);
  assert.doesNotMatch(listing.stdout, /opencode\.json/u);
});

test("version declarations stay synchronized", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  const core = await fs.readFile(path.join(root, "runtime", "lib", "core.mjs"), "utf8");
  assert.equal(version, packageJson.version);
  assert.match(readme, new RegExp(`> 版本：${escapeRegex(version)}`, "u"));
  assert.match(core, new RegExp(`RUNTIME_VERSION = "${escapeRegex(version)}"`, "u"));
});

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
