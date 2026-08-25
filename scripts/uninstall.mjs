import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const configArgument = process.argv.indexOf("--config");
const requestedConfig = configArgument >= 0 ? process.argv[configArgument + 1] : null;
if (configArgument >= 0 && !requestedConfig) {
  throw new Error("--config requires a directory path.");
}
const purge = process.argv.includes("--purge");
const configRoot = path.resolve(
  requestedConfig ?? process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode"),
);
const agentPath = path.join(configRoot, "agents", "drawing-master.md");
const runtimePath = path.join(configRoot, "drawing-master");
const rulesPath = path.join(configRoot, "AGENTS.md");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const removed = [];

await deactivate(agentPath);
await deactivate(runtimePath);
await removeRoutingRule();

process.stdout.write([
  `Uninstalled Drawing Master from ${configRoot}`,
  ...(removed.length > 0 ? removed.map((entry) => `- ${entry}`) : ["- No active installation was found."]),
  purge ? "Installation files were permanently removed." : "Installation files were renamed as uninstall backups.",
  "Restart or reload opencode to refresh the agent list.",
  "",
].join("\n"));

async function deactivate(target) {
  if (!(await exists(target))) return;
  if (purge) {
    await fs.rm(target, { recursive: true, force: true });
    removed.push(`removed ${target}`);
    return;
  }
  const backup = `${target}.uninstalled-${stamp}`;
  await fs.rename(target, backup);
  removed.push(`moved ${target} to ${backup}`);
}

async function removeRoutingRule() {
  if (!(await exists(rulesPath))) return;
  const start = "<!-- drawing-master-routing:start -->";
  const end = "<!-- drawing-master-routing:end -->";
  const current = await fs.readFile(rulesPath, "utf8");
  const pattern = new RegExp(`(?:\\r?\\n)?${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}(?:\\r?\\n)?`, "u");
  if (!pattern.test(current)) return;
  const updated = current.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  await fs.writeFile(rulesPath, updated ? `${updated}\n` : "", "utf8");
  removed.push(`removed routing rule from ${rulesPath}`);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
