> 简介：Drawing Master 的贡献和验证约定。

## 开发环境

- Node.js 20 或更高版本。
- opencode，用于端到端 Agent 验证。
- Git，用于提交和版本管理。

项目没有第三方运行时依赖。克隆后可直接运行：

```shell
npm test
```

## 修改原则

- DiagramSpec 和任何输出格式变化必须同步更新测试与文档。
- 不得让 Agent 直接手写最终格式产物，必须经过运行时编译和质量门。
- Excalidraw 原位修改必须保留未知字段、未知元素和无关样式。
- Mermaid 和 draw.io 受管重编译必须检查产物哈希，不得静默覆盖手工修改。
- 新增核心图表类型必须提供专用布局、黄金规格、稳定哈希和质量测试。
- 新增扩展图表类型至少提供 Schema 与编译 smoke test。
- 不得提交 API Key、个人 `opencode.json`、`.drawing-master/` 运行状态或生成备份。

## 提交前检查

```shell
npm test
npm run package:release
```

## 发布验收

发布多格式版本前还应完成以下检查，并在 GitHub Release 或等效发布记录中记录结果：

- 在 Excalidraw 中打开代表性 `.excalidraw` 产物。
- 在 Mermaid Live 或兼容 Mermaid 10+ 的编辑器中打开 `fixtures/mermaid/` 的代表性 fixture。
- 在 diagrams.net 中打开 `fixtures/drawio/` 的代表性 fixture。
- 真实运行已安装 Agent，确认未指定格式时询问并允许多选，在指定扩展名时不重复询问。
- 检查发布包只含白名单内容，`SHA256SUMS.txt` 与最终归档一致。
- 确认版本声明、变更日志、标签和发布说明一致，并记录人工验收环境与结果。

提交信息应简洁说明行为变化。涉及不可轻易逆转的架构取舍时，请在 `docs/adr/` 添加 ADR。
