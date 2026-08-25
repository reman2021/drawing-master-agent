> 日期：2026-08-25
> 版本：0.1.0
> 状态：可安装的 MVP
> 简介：面向 opencode 的可编辑 Excalidraw 图表专用子代理。

## 项目简介

Drawing Master 是一个全局 opencode 子代理。当用户要求创建或修改流程图、架构图、时序图、ER 图等可编辑图表时，主代理可以自动把任务委派给 `drawing-master`。

它不会让模型直接拼装最终 Excalidraw 文件，而是采用：

```text
自然语言 → DiagramSpec → 确定性布局与编译 → 质量门 → .excalidraw
```

最终文件可在 [excalidraw.com](https://excalidraw.com)、VS Code Excalidraw 扩展或其他兼容编辑器中继续修改。

## 能力范围

支持：

- 根据文字需求创建可编辑图表。
- 非破坏性修改自产或外部 `.excalidraw` 文件。
- 保留无关元素、未知字段和用户手工样式。
- 自动备份、稳定身份、规格持久化和 Schema 迁移。
- 结构验证及重叠、文字容量、连线穿越等视觉启发式检查。

不支持：

- 艺术插画、照片编辑和普通图片生成。
- 统计数据绘图和 CAD。
- 从图片复刻为可编辑图表。
- PNG/SVG 自动导出。

完整边界和术语见 [CONTEXT.md](CONTEXT.md)，定稿方案见 [DRAWING-MASTER-PLAN.md](DRAWING-MASTER-PLAN.md)。

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

也可以显式调用：

```text
@drawing-master 创建一个包含客户端、API 网关、认证服务、订单服务和数据库的架构图。
```

修改已有图：

```text
@drawing-master 修改 drawings/login-flow.excalidraw，把“提示错误”改成“记录失败并提示错误”，其他内容保持不变。
```

新建文件默认写入当前项目的 `drawings/`；同名文件自动递增。修改已有文件前会在 `.drawing-master/backups/` 创建备份。

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

### 扩展类型

扩展类型包括组织架构图、甘特图、时间线、树形图、网络拓扑图、数据流图、概念图、鱼骨图、SWOT、金字塔图、漏斗图、韦恩图、矩阵图和信息图。

扩展类型经过 Schema 和编译 smoke test，但首版不承诺与核心类型相同的视觉回归等级。

## 运行时命令

项目内调试：

```shell
node runtime/cli.mjs compile fixtures/specs/flowchart.json
node runtime/cli.mjs validate drawings/用户登录流程.excalidraw
node runtime/cli.mjs update drawings/用户登录流程.excalidraw updated-spec.json
node runtime/cli.mjs migrate old-spec.json --write
```

全局安装后：

```powershell
node "$HOME/.config/opencode/drawing-master/cli.mjs" validate "drawings/example.excalidraw"
```

命令成功时以 JSON 返回输出路径、规格路径和质量报告。质量错误会返回非零退出码且不写入最终文件；质量警告会随结果报告。

## DiagramSpec

最小规格：

```json
{
  "schemaVersion": 1,
  "documentId": "hello-flow",
  "title": "最小流程",
  "type": "flowchart",
  "nodes": [
    { "id": "start", "label": "开始", "kind": "start" },
    { "id": "finish", "label": "完成", "kind": "end" }
  ],
  "edges": [
    { "id": "e1", "from": "start", "to": "finish" }
  ]
}
```

可选字段包括：

- `groups`：系统边界或语义分区。
- `lanes`：泳道定义。
- `annotations`：独立注释文字。
- `layout`：方向、间距、列数和是否整体重排。
- `theme`：背景、文字、描边和调色板。
- 节点 `position/size/style`：仅在明确控制视觉属性时使用。
- `existingElementId`：修改外部文档时把语义节点映射到已有元素。

八个核心类型的完整规格位于 [`fixtures/specs/`](fixtures/specs/)。

## 项目结构

```text
.opencode/agents/      Agent 源文件
runtime/               无第三方依赖的 Node.js 运行时
fixtures/specs/        核心类型黄金 DiagramSpec
fixtures/excalidraw-v2 格式兼容快照
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

- 核心八类确定性编译和黄金规格。
- 扩展十四类结构 smoke test。
- 当前 Excalidraw v2 独立文本、绑定和 frame 格式。
- 未知元素、未知字段、样式和位置的无损保留。
- 超过三十节点自动分 frame。
- 备份保留十版。
- 已知 Schema 迁移和未知新版本拒绝写入。
- CLI 覆盖保护、校验、更新和损坏源文件保护。
- 全局安装、重复安装、路由规则保留和安全卸载。
- 发布包内容白名单和 SHA-256 校验文件。

## 打包与发布

生成可分发的压缩包：

```shell
npm run package:release
```

输出位于 `dist/`：

```text
drawing-master-agent-v0.1.0.tar.gz
drawing-master-agent-v0.1.0.zip
SHA256SUMS.txt
```

ZIP 依赖系统 `tar` 或 `zip` 能力；`.tar.gz` 是必定生成的跨平台发布物。

推送 `v*` 标签后，[GitHub Release 工作流](.github/workflows/release.yml) 会运行测试、生成发布包并上传 Release：

```shell
git tag v0.1.0
git push origin v0.1.0
```

版本发布时应同步更新 `package.json`、`VERSION`、README 顶部版本和 [CHANGELOG.md](CHANGELOG.md)。

## 限制

- 运行时不依赖浏览器或 Canvas，文字尺寸采用中英文字符宽度启发式。
- 线条交叉和节点穿越检查是几何近似，不是像素级渲染验收。
- Excalidraw 顶层版本长期为 2，但内部字段仍可能演化，需要持续维护 [`fixtures/excalidraw-v2/`](fixtures/excalidraw-v2/)。
- 新 Agent 或全局规则安装后通常需要重启 opencode 才会进入自动发现列表。

## 参考与许可

本项目的自然语言绘图、图表类型规范和连接优化思路受到 [smart-excalidraw-next](https://github.com/liujuntao123/smart-excalidraw-next) 启发。参考项目采用 MIT License。

本项目重新设计了领域模型、DiagramSpec、确定性编译、非破坏性修改、质量门和 opencode 集成，没有复制参考项目的 Skeleton 转换代码。

Drawing Master 自身采用 [MIT License](LICENSE)。安全报告方式见 [SECURITY.md](SECURITY.md)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
