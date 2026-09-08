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
- `check` 是只读命令，不创建图表、规格副本、manifest 或备份。
- 受管 manifest 路径必须保持在工作区内；覆盖提交会在替换前复核内容哈希，检测到并发修改即停止。
- 架构源码证据仅通过本地只读 Git 命令验证，禁用协议访问、惰性抓取和交互提示，不联网获取缺失提交。
- 源码证据只接受安全的仓库相对 POSIX 路径、完整提交 SHA 和有限行号，不在产物中生成主动链接。
- Agent 生成的图表内容可能发送给调用者配置的模型提供商；用户应根据数据敏感度选择模型和部署方式。
