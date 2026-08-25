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

- DiagramSpec 和 Excalidraw 格式变化必须同步更新测试与文档。
- 不得让 Agent 直接手写最终 `.excalidraw`，必须经过运行时编译和质量门。
- 修改已有图表时必须保留未知字段、未知元素和无关样式。
- 新增核心图表类型必须提供专用布局、黄金规格、稳定哈希和质量测试。
- 新增扩展图表类型至少提供 Schema 与编译 smoke test。
- 不得提交 API Key、个人 `opencode.json`、`.drawing-master/` 运行状态或生成备份。

## 提交前检查

```shell
npm test
npm run package:release
```

提交信息应简洁说明行为变化。涉及不可轻易逆转的架构取舍时，请在 `docs/adr/` 添加 ADR。
