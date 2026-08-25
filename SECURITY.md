> 支持范围：最新发布版本。

## 报告安全问题

请不要在公开 Issue 中提交 API Key、访问令牌、个人 opencode 配置或未脱敏的用户图表。

安全问题可以通过 GitHub 仓库的 Security Advisory 私下报告：

`https://github.com/reman2021/drawing-master-agent/security/advisories/new`

报告应包含受影响版本、复现步骤、潜在影响和建议修复方式。

## 安全边界

- 安装器只写入 `~/.config/opencode/agents/drawing-master.md`、`~/.config/opencode/drawing-master/` 和全局 `AGENTS.md` 中带标记的路由区块。
- 安装器不会读取或复制 `opencode.json`、API Key 或模型提供商凭证。
- 卸载器只移除本项目的活动安装路径和带标记的路由区块，默认把现有安装改名保留，而不是永久删除。
- Drawing Master 会把 DiagramSpec、清单和备份写入目标项目的 `.drawing-master/`。
- Agent 生成的图表内容可能发送给调用者配置的模型提供商；用户应根据数据敏感度选择模型和部署方式。
