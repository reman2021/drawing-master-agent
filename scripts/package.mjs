import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const outputArgument = process.argv.indexOf("--output");
const requestedOutput = outputArgument >= 0 ? process.argv[outputArgument + 1] : null;
if (outputArgument >= 0 && !requestedOutput) {
  throw new Error("--output requires a directory path.");
}
const outputRoot = path.resolve(requestedOutput ?? path.join(projectRoot, "dist"));
const releaseName = `drawing-master-agent-v${packageJson.version}`;
const stageRoot = path.join(outputRoot, releaseName);
const archivePath = path.join(outputRoot, `${releaseName}.tar.gz`);
const checksumPath = path.join(outputRoot, "SHA256SUMS.txt");

const releaseEntries = [
  ".github",
  ".opencode/agents/drawing-master.md",
  "docs",
  "examples",
  "fixtures",
  "runtime",
  "scripts",
  "test",
  ".gitignore",
  "CHANGELOG.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE.md",
  "package.json",
  "README.md",
  "SECURITY.md",
  "VERSION",
];

await fs.mkdir(outputRoot, { recursive: true });
await fs.rm(stageRoot, { recursive: true, force: true });
await fs.rm(archivePath, { force: true });
await fs.mkdir(stageRoot, { recursive: true });

for (const entry of releaseEntries) {
  const source = path.join(projectRoot, entry);
  if (!(await exists(source))) continue;
  await fs.cp(source, path.join(stageRoot, entry), { recursive: true, force: true });
}

run("tar", ["-czf", archivePath, "-C", outputRoot, releaseName]);
const artifacts = [archivePath];
const zipPath = path.join(outputRoot, `${releaseName}.zip`);
await fs.rm(zipPath, { force: true });
if (process.platform === "win32") {
  const result = spawnSync("tar", ["-a", "-cf", zipPath, "-C", outputRoot, releaseName], {
    encoding: "utf8",
  });
  if (result.status === 0) artifacts.push(zipPath);
} else {
  const result = spawnSync("zip", ["-qr", zipPath, releaseName], {
    cwd: outputRoot,
    encoding: "utf8",
  });
  if (result.status === 0) artifacts.push(zipPath);
}

const checksums = [];
for (const artifact of artifacts) {
  const digest = crypto.createHash("sha256").update(await fs.readFile(artifact)).digest("hex");
  checksums.push(`${digest}  ${path.basename(artifact)}`);
}
await fs.writeFile(checksumPath, `${checksums.join("\n")}\n`, "utf8");
await fs.rm(stageRoot, { recursive: true, force: true });

process.stdout.write([
  `Packaged Drawing Master ${packageJson.version}`,
  ...artifacts.map((artifact) => `- ${artifact}`),
  `- ${checksumPath}`,
  "",
].join("\n"));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
