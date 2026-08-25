> 日期：2026-08-25
> 来源：`/grill-with-docs` 审查定稿
> 状态：已确认，实施中
> 参考：[smart-excalidraw-next](https://github.com/liujuntao123/smart-excalidraw-next)

## 目标

构建一个名为 `drawing-master` 的 opencode 全局子代理。当用户请求创建或修改可编辑图表时，主代理将任务委派给它，由它生成可继续编辑的 `.excalidraw` 文件。

本项目借鉴 smart-excalidraw-next 的自然语言绘图、图表类型视觉规范和连接优化思路，但不复制其 `ExcalidrawElementSkeleton` 实现。Agent 生成语义化 `DiagramSpec`，再由本地确定性编译器生成完整 Excalidraw 文档。

## 能力边界

- 支持创建和修改可编辑图表。
- 支持从文字需求和已有 `.excalidraw` 文件工作。
- 不承担艺术插画、统计绘图、CAD 或普通图片生成。
- 不承担图片到可编辑图表的复刻。
- 需求缺少布局或样式信息时使用默认值；缺少会改变业务语义的信息时最多进行一轮澄清。
- 不自行扩写用户未提供的业务内容。

## 架构

```text
用户绘图请求
    ↓
drawing-master 语义分析
    ↓
DiagramSpec
    ↓
确定性布局器与 Excalidraw 编译器
    ↓
结构验证与视觉启发式质量门
    ↓
.excalidraw 交付物
    +
.drawing-master/ 规格、清单与备份
```

详细决策见：

- [采用语义规格与确定性编译器](docs/adr/0001-semantic-spec-and-compiler.md)
- [采用非破坏性修改与持久身份](docs/adr/0002-nondestructive-editing.md)
- [采用自包含全局 Agent 与独立运行时](docs/adr/0003-global-agent-runtime.md)

## 图表支持等级

### 核心类型

以下八类具有专用布局策略、验收规则和黄金样例：

- 流程图
- 架构图
- 时序图
- ER 图
- 思维导图
- UML 类图
- 状态图
- 泳道图

### 扩展类型

组织架构图、甘特图、时间线、树形图、网络拓扑图、数据流图、概念图、鱼骨图、SWOT、金字塔图、漏斗图、韦恩图、矩阵图和信息图提供语义编译与结构 smoke test，不承诺与核心类型相同的视觉质量等级。

## 文件与修改策略

- 新建文件默认写入当前项目的 `drawings/`，同名文件自动递增，不覆盖。
- 明确请求修改原文件时才原位更新。
- 原位更新前备份到 `.drawing-master/backups/`，每个文档保留最近十版。
- `.drawing-master/manifest.json` 关联文档、DiagramSpec、Schema 版本和编译时间。
- DiagramSpec 默认可提交到 Git；备份与临时文件应忽略。
- 生成元素通过 `customData.drawingMaster` 保存稳定语义 ID。
- 修改外部文件时宽容读取并透传未知字段和未知元素。
- 修改默认保留用户手工调整的位置、尺寸和样式。
- 多个候选元素无法可靠区分时，先列出候选并询问用户。

## 布局与质量门

- 相同 DiagramSpec 和 seed 必须产生稳定布局。
- 已有节点优先保留位置，只为新增或冲突区域布局。
- 超过三十个节点时按子域或层级拆分 frame，并保留总览。
- 相关多视图放入同一文档的多个 frame；不相关主题分别输出文件。
- 质量错误阻断交付；警告可以随报告交付。
- 发现可修复问题时最多自动重排两次。
- 检查 JSON 结构、ID 唯一性、引用完整性、非法坐标、节点重叠、文字容量、边界和线条交叉。

## 兼容与迁移

- 以当前 excalidraw.com 导出的 v2 文档 fixture 作为格式快照。
- DiagramSpec 包含显式 `schemaVersion`。
- 已知旧版本按顺序迁移，迁移前备份。
- 遇到未知新版本时只读并拒绝覆盖。

## 部署

项目保存 Agent 和运行时源码，安装后形成：

```text
~/.config/opencode/agents/drawing-master.md
~/.config/opencode/drawing-master/
```

Agent 自包含核心规范，不以 skill 加载器作为运行前提。全局 `AGENTS.md` 增加可编辑图表任务必须委派给 `drawing-master` 的路由规则，并保留显式 `@drawing-master` 调用方式。

## 验收

- 核心八类各有中文黄金样例、确定性测试和质量门测试。
- 扩展十四类具有 Schema 与编译 smoke test。
- 验证未知元素、未知字段和手工样式在原位修改后保持不变。
- 验证超过三十节点时自动分帧。
- 验证损坏文件拒绝写入且原文件保持不变。
- 验证备份保留、清理和恢复。
- 验证已知版本迁移及未知新版本拒绝写入。

## 已知限制

- 无第三方依赖的实现不包含真实浏览器渲染；文字尺寸和连线交叉依赖几何启发式。
- Excalidraw 格式可能演化，需要维护格式 fixture 和迁移器。
- 自动委派由 Agent 描述和全局规则共同提高命中率，但用户仍可通过 `@drawing-master` 手动兜底。
