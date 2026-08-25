> 核对日期：2026-08-25
> 格式基线：Excalidraw 顶层 version 2
> 上游参考提交：`e160ff7ba0641fba729c528482de5277ffb19c58`

## 快照范围

`minimal-shape-arrow-frame.excalidraw` 固定以下磁盘格式契约：

- 容器标签使用独立 `text` 元素和 `containerId`，不是 Skeleton API 的 `label` 字段。
- 容器和文本保留双向引用。
- 箭头使用局部坐标 `points`。
- 箭头绑定使用 `elementId`、`fixedPoint` 和 `mode`。
- frame 成员通过子元素 `frameId` 指定，frame 本身没有 `children`。
- frame 子元素排在 frame 元素之前。
- `customData` 可以保存可序列化扩展元数据。

## 上游资料

- [Excalidraw JSON Schema](https://docs.excalidraw.com/docs/codebase/json-schema)
- [元素类型](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/types.ts)
- [恢复与迁移](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/data/restore.ts)
- [Skeleton 转换](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/transform.ts)
- [Frame 排序规则](https://docs.excalidraw.com/docs/codebase/frames)
