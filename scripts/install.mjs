import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configArgument = process.argv.indexOf("--config");
const requestedConfig = configArgument >= 0 ? process.argv[configArgument + 1] : null;
if (configArgument >= 0 && !requestedConfig) {
  throw new Error("--config requires a directory path.");
}
const configRoot = path.resolve(
  requestedConfig ?? process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode"),
);
const agentSource = path.join(projectRoot, ".opencode", "agents", "drawing-master.md");
const agentTarget = path.join(configRoot, "agents", "drawing-master.md");
const runtimeSource = path.join(projectRoot, "runtime");
const runtimeTarget = path.join(configRoot, "drawing-master");
const rulesPath = path.join(configRoot, "AGENTS.md");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

await fs.mkdir(path.dirname(agentTarget), { recursive: true });
await fs.mkdir(configRoot, { recursive: true });

await backupIfPresent(agentTarget);
await backupIfPresent(runtimeTarget);
await fs.copyFile(agentSource, agentTarget);
await fs.cp(runtimeSource, runtimeTarget, { recursive: true, force: true });
await installRoutingRule();

process.stdout.write([
  `Installed agent: ${agentTarget}`,
  `Installed runtime: ${runtimeTarget}`,
  `Updated routing rules: ${rulesPath}`,
  "Restart or reload opencode, then invoke @drawing-master or request an editable diagram.",
  "",
].join("\n"));

async function backupIfPresent(target) {
  try {
    await fs.access(target);
  } catch {
    return;
  }
  await fs.cp(target, `${target}.backup-${stamp}`, { recursive: true, force: true });
}

async function installRoutingRule() {
  const start = "<!-- drawing-master-routing:start -->";
  const end = "<!-- drawing-master-routing:end -->";
  const block = [
    start,
    "## 绘图任务委派",
    "",
    "当用户请求创建或修改可编辑图表时，必须委派给 `drawing-master` 子代理。此规则适用于流程图、架构图、时序图、ER 图、思维导图、UML、状态图、泳道图、组织架构图、甘特图、时间线、树形图、网络拓扑图、数据流图、概念图、鱼骨图、SWOT、金字塔图、漏斗图、韦恩图、矩阵图、信息图，以及明确提及 Excalidraw 或 diagram 的任务。",
    "",
    "艺术插画、统计绘图、CAD 和普通图片生成不属于绘图任务，不得委派给 `drawing-master`。如果自动委派没有发生，提示用户可显式使用 `@drawing-master`。",
    end,
  ].join("\n");

  let current = "";
  try {
    current = await fs.readFile(rulesPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const pattern = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`, "u");
  const updated = pattern.test(current)
    ? current.replace(pattern, block)
    : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
  await fs.writeFile(rulesPath, updated, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
