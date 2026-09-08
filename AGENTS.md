> 适用范围：Drawing Master 仓库开发。面向产品使用者的行为说明以 [`README.md`](README.md) 和 [`CONTEXT.md`](CONTEXT.md) 为准。

## 工具链与验证

- 使用 Node.js 20 及以上版本。根包没有第三方依赖、workspace 或转译阶段；克隆后直接运行 `npm test`，不要臆造 `npm install`、build、lint、format、typecheck 或 codegen 步骤。
- 全量测试：`npm test`。单文件测试：`npm test -- test/runtime.test.mjs`、`npm test -- test/formats.test.mjs`、`npm test -- test/cli.test.mjs` 或 `npm test -- test/distribution.test.mjs`。
- 按测试名聚焦时直接运行 `node --test --test-name-pattern="<模式>" test/<文件>.test.mjs`；不要通过 npm 转发 `--test-name-pattern`。
- 全量测试和发布打包会实际调用系统 `tar`。发布前按 `npm test`、`npm run package:release` 的顺序执行；打包命令本身不运行测试。
- `npm run package:release` 会删除并重建输出目录中的同名 staging、归档和校验文件。需要隔离输出时使用 `node scripts/package.mjs --output <目录>`；ZIP 生成失败会降级为仅生成 `.tar.gz`。

## 代码边界

- `.opencode/agents/drawing-master.md` 是可发布 Agent 的唯一源文件；`scripts/install.mjs` 将它和 `runtime/` 安装到用户全局 OpenCode 配置。被忽略的 `.opencode/package.json`、lockfile 和 `node_modules` 只是本机 OpenCode 状态，不是第二个包。
- `runtime/cli.mjs` 是唯一 CLI 入口。`runtime/lib/core.mjs` 定义 DiagramSpec，`schema-validator.mjs` 执行 v2 严格校验，`artifact.mjs` 分派格式，`compiler.mjs`、`mermaid.mjs`、`drawio.mjs` 负责编译，`geometry.mjs` 和 `quality*.mjs` 执行共享几何与格式质量门，`workspace.mjs` 管理 manifest、哈希、备份和原子提交。
- `compile` 不是纯转换：它会写入 `.drawing-master/specs/` 和 manifest，并在未给输出路径时创建 `drawings/`。它必须通过 `--format` 或单一显式输出扩展名确定格式，不默认 Excalidraw；多格式编译不能同时指定单一输出路径。
- `sync` 仅处理 manifest 中已有的受管文档；手工修改或缺失的产物需要显式选择 `--conflict` 或 `--missing` 策略。`update` 只支持外部 `.excalidraw` 原位修改并会先备份。
- `check` 只在内存中校验规格、三格式编译结果和可选本地 Git 证据，不得写入工作区。`guide` 只执行确定性类型推荐。

## Agent 提示词

- 提示词以准确、可执行和低上下文开销为目标。优先删除重复、合并同义约束，并只保留能说明字段结构或关键分支的最小示例；不以字数减少本身为目标。
- 精简不得删除或模糊行为边界、触发条件、操作分支、失败处理和强制性契约。每项规则应明确适用条件、动作及禁止事项，不能用宽泛原则替代可执行指令。
- 修改 Agent 或安装路由时同步检查两者及 `test/distribution.test.mjs`，确保独立生效的路由规则和 Agent 运行约束均受保护。

## 回归契约

- 不要让 Agent 或示例直接手写最终格式产物；DiagramSpec 变化必须经过运行时编译和对应质量门。
- 修改 DiagramSpec、布局、编译或序列化时，同时检查 `fixtures/golden-hashes.json`、`fixtures/golden-format-hashes.json`、`fixtures/mermaid/flowchart.mmd`、`fixtures/drawio/flowchart.drawio`、`examples/` 和相关文档。仓库没有自动更新这些产物的命令。
- 九个核心类型的多格式回归由黄金哈希覆盖；`fixtures/mermaid/` 和 `fixtures/drawio/` 当前各只有一个 flowchart 代表性文件，不要假定每类都有可打开的 fixture。
- Excalidraw 原位修改必须继续保留未知元素、未知字段及无关位置和样式。Mermaid/draw.io 受管重编译必须保留哈希冲突保护，不得静默覆盖手工修改。
- 黄金哈希和逐字 fixture 依赖 LF；`.gitattributes` 已固定图表、JSON、Markdown、MJS 和 YAML 为 LF，PowerShell 脚本为 CRLF。

## 安装与发布

- 安装/卸载会修改用户全局 OpenCode 配置，不要作为普通验证步骤运行。隔离测试安装器应使用 `node scripts/install.mjs --config <临时目录>`；`scripts/install.ps1` 不转发参数，而 `scripts/uninstall.ps1` 会转发。
- 版本升级需同步 `package.json`、`VERSION`、README 顶部版本、`CHANGELOG.md`，以及 `runtime/lib/core.mjs` 中的 `RUNTIME_VERSION`；现有版本同步测试不会检查最后两项。
- 不得提交 `.drawing-master/`、`drawings/`、生成备份、API Key 或个人 OpenCode 配置；这些是运行状态或用户产物，不是源码。
