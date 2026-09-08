> 日期：2026-09-08
> 版本：0.3.0
> 状态：可安装的可信多格式版本
> 简介：面向 opencode 的 Excalidraw、Mermaid 和 draw.io 可编辑图表子代理。

## 项目简介

Drawing Master 是一个全局 opencode 子代理。当用户要求创建或修改流程图、架构图、时序图、ER 图等可编辑图表时，主代理可以自动把任务委派给 `drawing-master`。

它不会让模型直接拼装最终 Excalidraw 文件，而是采用：

```text
自然语言 → 格式确认 → DiagramSpec v2 → 只读检查 → 确定性编译 → 格式质量门 → 可编辑产物与哈希回执
```

最终文件可以是 `.excalidraw`、纯 Mermaid `.mmd` 或未压缩 draw.io `.drawio`。同一 DiagramSpec 可以生成多个语义等价的格式产物。

## 能力范围

| 能力 | Excalidraw | Mermaid | draw.io |
|---|---:|---:|---:|
| 根据文字需求新建 | 支持 | 支持 | 支持 |
| 同一文档多格式同步 | 支持 | 支持 | 支持 |
| 受管产物重编译 | 支持 | 支持 | 支持 |
| 外部文件原位修改 | 支持 | 不支持 | 不支持 |
| 外部文件安全子集校验 | 支持 | 支持 | 支持 |
| 几何视觉启发式检查 | 支持 | 不执行 | 支持 |

Manifest 会记录规格和产物哈希。Mermaid 或 draw.io 受管产物存在手工修改时，同步会停止并要求用户选择覆盖并备份、另存新文件或取消，不会静默覆盖。Manifest 关联丢失时，只有产物内嵌身份与给定 DiagramSpec 的 `documentId` 和 `specHash` 同时匹配，才能显式恢复管理关系。

运行时提供统一诊断、`standard`/`showcase` 两档质量门和最终文件 SHA-256/字节数回执。`check` 只在内存中编译和检查，不创建 `drawings/`、规格副本或 manifest。

不支持：

- 艺术插画、照片编辑和普通图片生成。
- 统计数据绘图和 CAD。
- 从图片复刻为可编辑图表。
- PNG/SVG 自动导出。
- 从外部 Mermaid 或 draw.io 反向恢复 DiagramSpec。
- 无损修改压缩 draw.io、多页 draw.io 或任意 Mermaid 扩展语法。

完整边界和术语见 [CONTEXT.md](CONTEXT.md)，架构取舍见 [`docs/adr/`](docs/adr/)，发布验收见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安装

要求 Node.js 20 或更高版本。

从 [GitHub Releases](https://github.com/reman2021/drawing-master-agent/releases) 下载发布包并解压，或克隆仓库：

```shell
git clone https://github.com/reman2021/drawing-master-agent.git
cd drawing-master-agent
```

在 PowerShell 中运行：

```powershell
pwsh -File scripts/install.ps1
```

也可以直接运行跨平台安装器：

```shell
node scripts/install.mjs
```

安装器会：

- 复制 Agent 到 `~/.config/opencode/agents/drawing-master.md`。
- 复制运行时到 `~/.config/opencode/drawing-master/`。
- 在全局 `AGENTS.md` 中以可识别标记区块添加绘图任务委派规则。
- 修改前备份同名 Agent 和运行时目录。

安装完成后重启或重新加载 opencode。

## 卸载

安全卸载会移除路由区块，并把 Agent 和运行时改名保留为卸载备份：

```powershell
pwsh -File scripts/uninstall.ps1
```

跨平台命令：

```shell
node scripts/uninstall.mjs
```

确认不需要备份时可永久删除：

```shell
node scripts/uninstall.mjs --purge
```

## 使用

安装后可以直接描述绘图任务：

```text
画一个用户登录流程图，凭证错误时允许重试。
```

由于没有指定格式，`drawing-master` 会询问选择一个或多个 Excalidraw、Mermaid 或 draw.io 输出。

也可以显式调用：

```text
@drawing-master 用 Mermaid 和 draw.io 创建一个包含客户端、API 网关、认证服务、订单服务和数据库的架构图。
```

修改已有图：

```text
@drawing-master 修改 drawings/login-flow.excalidraw，把“提示错误”改成“记录失败并提示错误”，其他内容保持不变。
```

新建文件默认写入当前项目的 `drawings/`；同批多格式产物共用文件名 stem，同名时整批自动递增。自产图更新默认同步全部已登记格式，覆盖前按文档和格式分别保留最近十版备份。

## 输出格式

| 格式 | 规范扩展名 | 说明 |
|---|---|---|
| Excalidraw | `.excalidraw` | Excalidraw v2 JSON，支持外部文件非破坏性修改。 |
| Mermaid | `.mmd` | 兼容 `.mermaid`；输出 Mermaid 10+ 安全子集，不含 Markdown 围栏。 |
| draw.io | `.drawio` | 未压缩、单页 `mxGraphModel` XML，可直接在 diagrams.net 打开。 |

Mermaid 优先使用稳定原生语法。语义不足或类型没有安全原生表达时，会明确降级为 flowchart 并报告警告。Mindmap 和 Timeline 原生语法会报告实验性兼容警告。

## 支持类型

### 核心类型

| 类型 | DiagramSpec `type` | 专用能力 |
|---|---|---|
| 流程图 | `flowchart` | 开始、结束、处理和判断节点，分层流向 |
| 架构图 | `architecture` | 系统边界、组件和分层布局 |
| 时序图 | `sequence` | 参与者、生命线和有序消息 |
| ER 图 | `er` | 实体、属性、关系和基数标签 |
| 思维导图 | `mindmap` | 中心主题和放射分支 |
| UML 类图 | `class` | 继承、聚合、组合和关联 |
| 状态图 | `state` | 状态、初末节点和条件转换 |
| 泳道图 | `swimlane` | 角色泳道和跨泳道流程 |
| 数据流图 | `dataflow` | 数据源、处理、存储和数据流向 |

### 扩展类型

扩展类型包括组织架构图、甘特图、时间线、树形图、网络拓扑图、概念图、鱼骨图、SWOT、金字塔图、漏斗图、韦恩图、矩阵图和信息图。

扩展类型经过 Schema 和编译 smoke test，但首版不承诺与核心类型相同的视觉回归等级。

## 运行时命令

项目内调试：

```shell
node runtime/cli.mjs compile fixtures/specs/flowchart.json --format mermaid
node runtime/cli.mjs compile fixtures/specs/flowchart.json --format excalidraw --format mermaid --format drawio
node runtime/cli.mjs sync updated-spec.json --workspace .
node runtime/cli.mjs sync updated-spec.json --format mermaid --workspace .
node runtime/cli.mjs recover fixtures/specs/flowchart.json drawings/用户登录流程.excalidraw drawings/用户登录流程.mmd --workspace .
node runtime/cli.mjs check updated-spec.json --quality showcase
node runtime/cli.mjs guide "展示服务边界和技术分层"
node runtime/cli.mjs validate drawings/用户登录流程.excalidraw
node runtime/cli.mjs update drawings/用户登录流程.excalidraw updated-spec.json
node runtime/cli.mjs migrate old-spec.json --write
```

全局安装后：

```powershell
node "$HOME/.config/opencode/drawing-master/cli.mjs" validate "drawings/example.excalidraw"
```

`compile` 必须通过 `--format` 或显式输出扩展名确定格式，不默认 Excalidraw。`sync` 默认更新同一文档的全部受管产物；重复传入 `--format` 可只同步指定格式，其他未同步产物在规格变化后保持原文件并呈现为 `stale`。`recover` 用匹配的 DiagramSpec 和一个或多个自产格式产物重建丢失的 Manifest 关联，不从产物反向生成 DiagramSpec。`update` 只用于外部 Excalidraw 原位修改。`check` 默认在内存中检查三种格式；架构规格含源码证据时，可用 `--repo <本地仓库根目录>` 验证 origin、完整提交 SHA、文件和行号。

命令成功时以 JSON 返回输出路径、规格路径、质量报告，以及最终文件的 `sha256` 和 `bytes`。诊断统一包含 `code`、`severity`、`message`、`subject`、`evidence` 和 `supportedFixes`。质量错误会返回非零退出码且不写入最终文件；质量警告会随结果报告。

## DiagramSpec

最小规格：

```json
{
  "schemaVersion": 2,
  "documentId": "hello-flow",
  "title": "最小流程",
  "type": "flowchart",
  "nodes": [
    { "id": "start", "label": "开始", "kind": "start" },
    { "id": "finish", "label": "完成", "kind": "end" }
  ],
  "edges": [
    { "id": "e1", "from": "start", "to": "finish", "kind": "directed" }
  ]
}
```

可选字段包括：

- `groups`：系统边界或语义分区。
- `lanes`：泳道定义。
- `annotations`：独立注释文字。
- `layout`：方向、间距、列数和是否整体重排。
- `theme`：背景、文字、描边和调色板。
- 关系 `fromSide`、`toSide`、`via` 和 `labelAt`：显式控制端口、正交途经点和标签位置。
- 架构图 `provenance.repository` 与节点 `sources`：可选的 revision-pinned 本地源码证据，不生成主动链接。
- 节点 `position/size/style`：仅在明确控制视觉属性时使用。
- `existingElementId`：修改外部文档时把语义节点映射到已有元素。

DiagramSpec v2 对未知字段和类型专属语义失败关闭；v1 规格继续可编译。`migrate <spec.json>` 预览迁移结果，增加 `--write` 后先备份再写回 v2。

新生成的 Excalidraw 和 draw.io 节点默认使用 `24px` 字号，边标签默认使用 `18px`，注释默认使用 `18px`；节点仍以 `200×88` 为普通类型的最小尺寸，并按换行结果自动扩展。节点和边的 `style.fontSize` 可覆盖默认值。Mermaid 的字号和形状尺寸由目标渲染器及主题控制，不保证与显式几何格式保持相同视觉比例。

九个核心类型的完整规格位于 [`fixtures/specs/`](fixtures/specs/)。

## 项目结构

```text
.opencode/agents/      Agent 源文件
runtime/               无第三方依赖的多格式 Node.js 运行时
fixtures/specs/        核心类型黄金 DiagramSpec
fixtures/excalidraw-v2 格式兼容快照
fixtures/mermaid/      Mermaid 安全子集代表性 fixture
fixtures/drawio/       draw.io 未压缩 XML 代表性 fixture
test/                  Node 内置测试
examples/              可直接打开的示例文件
scripts/               全局安装脚本
docs/adr/              架构决策记录
```

## 测试

```shell
npm test
```

当前测试包括：

- 核心九类确定性编译和黄金规格。
- 扩展十三类结构 smoke test。
- 当前 Excalidraw v2 独立文本、绑定和 frame 格式。
- Mermaid 和 draw.io 确定性编译、原生映射、格式降级和安全转义。
- 默认字号、显式字号传播、长文本换行和固定高度布局的排版回归。
- 三格式共同命名、manifest v2、多产物状态、选择性同步、身份恢复和同步冲突保护。
- 未知元素、未知字段、样式和位置的无损保留。
- 超过三十节点自动分 frame。
- 备份保留十版。
- 已知 Schema 迁移和未知新版本拒绝写入。
- CLI 覆盖保护、校验、更新和损坏源文件保护。
- DiagramSpec v2 严格字段、类型语义、v1 兼容迁移和只读 `check`。
- 确定性端口与折线路由、几何证据、质量档位和交付回执。
- 本地 Git 源码证据验证，不联网且不修改仓库。
- 全局安装、重复安装、路由规则保留和安全卸载。
- 发布包内容白名单和 SHA-256 校验文件。

## 打包与发布

生成可分发的压缩包：

```shell
npm run package:release
```

输出位于 `dist/`：

```text
drawing-master-agent-v0.3.0.tar.gz
drawing-master-agent-v0.3.0.zip
SHA256SUMS.txt
```

ZIP 依赖系统 `tar` 或 `zip` 能力；`.tar.gz` 是必定生成的跨平台发布物。

推送 `v*` 标签后，[GitHub Release 工作流](.github/workflows/release.yml) 会运行测试、生成发布包并上传 Release：

```shell
git tag v0.3.0
git push origin v0.3.0
```

版本发布时应同步更新 `package.json`、`VERSION`、README 顶部版本和 [CHANGELOG.md](CHANGELOG.md)。

## 限制

- 运行时不依赖浏览器或 Canvas，文字尺寸采用中英文字符宽度启发式。
- 线条交叉和节点穿越检查是几何近似，不是像素级渲染验收。
- Excalidraw 顶层版本长期为 2，但内部字段仍可能演化，需要持续维护 [`fixtures/excalidraw-v2/`](fixtures/excalidraw-v2/)。
- Mermaid 输出只保证安全子集的结构和语义，不执行真实渲染或视觉检查。
- draw.io 显式序列化受管文本字号，但首版只生成和校验未压缩单页 XML，不支持压缩 payload 或外部文件无损修改。
- 新 Agent 或全局规则安装后通常需要重启 opencode 才会进入自动发现列表。

## 参考与许可

本项目的自然语言绘图、图表类型规范和连接优化思路受到 [smart-excalidraw-next](https://github.com/liujuntao123/smart-excalidraw-next) 启发；强类型规格、诊断和可信交付机制参考了 [Archify](https://github.com/tt-a1i/archify)。两个参考项目均采用 MIT License。

本项目重新设计了领域模型、DiagramSpec、确定性编译、非破坏性修改、质量门和 opencode 集成，没有复制参考项目的 Skeleton 转换代码。

Drawing Master 自身采用 [MIT License](LICENSE)。安全报告方式见 [SECURITY.md](SECURITY.md)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
