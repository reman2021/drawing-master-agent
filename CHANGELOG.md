> 本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 0.3.0（未发布）

### 新增

- Mermaid 10+ 安全子集和未压缩单页 draw.io 编译器。
- 同一 DiagramSpec 的多格式产物、共同命名和同步重编译。
- Manifest v2、规格/产物哈希及 `current`、`stale`、`modified`、`missing` 状态。
- Mermaid/draw.io 格式质量门、明确降级警告和主动内容防护。
- `sync` 命令及结构化 CLI 错误码。
- `sync --format` 选择性同步，未选格式在规格变化后保持原文件并标记为 `stale`。
- `recover` 身份恢复命令，只接受内嵌身份和规格哈希与 DiagramSpec 匹配的自产产物。
- 多产物、DiagramSpec 和 manifest 的批量提交、冲突回滚与并发覆盖保护。
- DiagramSpec v2 严格字段及类型语义契约，保留 v1 编译兼容和显式迁移。
- 统一结构化诊断、只读 `check`、`standard`/`showcase` 质量档位及 SHA-256/字节数交付回执。
- 确定性端口展开、共享正交路由、标签净空和几何质量检查。
- `guide` 图表类型推荐，以及架构图本地 Git 提交、文件和行号证据验证。
- 数据流图提升为第九个核心类型。

### 变更

- 用户未指定 Excalidraw、Mermaid 或 draw.io 时，Agent 必须询问并允许多选。
- CLI 不再默认生成 Excalidraw；`compile` 必须提供 `--format` 或已知输出扩展名。
- `update` 仅用于 Excalidraw 原位修改；自产图通过 `sync` 更新全部受管格式。
- 备份保留调整为每个文档、每种格式最近十版。
- 新生成节点的默认字号由 `20px` 提升到 `24px`，边标签由 `16px` 提升到 `18px`。
- draw.io 显式写入节点、边、注释和分区标题字号，不再依赖编辑器的小号默认字体。
- Gantt、Pyramid 和 Funnel 根据换行结果扩展高度，避免较大字号下的文字裁切和行间重叠。
- Excalidraw 与 draw.io 消费同一组确定性端口和折线路由。

## 0.1.0 - 2026-08-25

### 新增

- `drawing-master` 全局 opencode 子代理及自动委派规则。
- DiagramSpec v1、确定性布局器和 Excalidraw v2 编译器。
- 新建、非破坏性修改、质量检查、备份和 Schema 迁移命令。
- 八类核心图表黄金样例和十四类扩展图表 smoke test。
- 跨平台 Node.js 安装器、PowerShell 包装脚本和全局运行时。
- 可复现发布打包器、安全卸载器和 GitHub Actions 工作流。
