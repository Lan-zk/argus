# design/ — 设计文档

开发前的设计阶段产物：数据流梳理与交互原型，作为实现参照（token 与基础样式即迁移自这里的原型）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `01-模块关系与数据流.html` | 模块关系与数据流图：domain / ai / orchestrator / stores / pages 的依赖与数据走向 |
| `02-产品交互原型.html` | 产品交互原型：三页布局与工作台双栏的原型实现，`src/styles/` 的 token 即由此迁移 |
| [`icons/`](./icons/README.md) | 应用图标设计源文件与生成说明 |

根目录 [DESIGN.md](../DESIGN.md) 是 Apple 风格设计语言分析（theme-system 中 apple 皮肤的取值依据），亦属设计资料。

这两个 HTML 是设计产物而非运行代码，浏览器直接打开即可查看，不参与构建。
