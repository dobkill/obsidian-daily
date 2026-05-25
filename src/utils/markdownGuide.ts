export const MARKDOWN_FORMAT_GUIDE = `# 项目管理插件 Markdown 语法说明

本说明对应当前插件实现。轻量 checklist 语法用于快速创建、批量导入和局部导出；完整记录导出会额外包含 JSON 数据块，用于保留项目、表格、看板、甘特图、思维导图、来源、笔记和写入历史。

## 项目分组

\`\`\`md
#项目：项目名
- [ ] 普通任务 kind:simple @2026-05-18 09:00-10:00 #tag !high status:doing
\`\`\`

- \`#项目：项目名\`：后续任务归属该项目，项目不存在时自动创建。
- \`#项目：\` 或 \`#项目：未归属项目\`：后续任务不绑定项目。

## 任务行

\`\`\`md
- [ ] 任务标题 kind:simple @2026-05-18 09:00-10:00 status:todo
- [x] 已完成的当天任务 kind:simple @2026-05-18 10:00-10:30 status:done finish:today
\`\`\`

支持参数：

- \`kind:simple | composite\`：普通任务或组合任务。
- \`@YYYY-MM-DD HH:mm-HH:mm\`：日期与可选时间段。
- \`#标签\`：任务标签，可写多个。
- \`!low | !medium | !high | !urgent\`：优先级。
- \`status:todo | doing | blocked | done\`：看板状态。
- \`repeat:once | daily | weekly | custom\`：重复类型。
- \`count:N\`：重复次数。
- \`until:YYYY-MM-DD\`：重复结束日期。
- \`dates:YYYY-MM-DD,YYYY-MM-DD\`：自定义发生日期。
- \`finish:today | series\`：仅在 \`- [x]\` 时生效。

## 组合任务轻量项

组合任务必须具备开始与结束时间。轻量项可只写标题，也可写自己的时间段；一旦填写时间，必须完全落在组合任务时间范围内。

\`\`\`md
- [ ] 组合任务 kind:composite @2026-05-18 14:00-16:00 status:todo
  - 梳理资料 @14:10-14:40
  - 输出结论 @15:00-15:40
\`\`\`

## 笔记同步块

全库扫描只读取 \`pm:start\` 与 \`pm:end\` 之间的任务块。

\`\`\`md
<!-- pm:start -->
#项目：插件体验示例
- [ ] 写解析器 kind:simple @2026-05-18 09:00-10:30 #plugin status:todo
<!-- pm:end -->
\`\`\`

## 历史隔离

今天以前的任务发生记录不可被编辑、删除、改时间或重新标记完成。编辑、删除、提前结束重复任务时，插件只改今天和未来的发生记录，过去记录保留旧版本。

## 完整记录导出

完整记录导出使用 Markdown 包裹 JSON：

\`\`\`md
<!-- pm:full-export:start -->
\`\`\`pm-project-management-json
{ "version": "0.4.0", "tasks": [] }
\`\`\`
<!-- pm:full-export:end -->
\`\`\`

JSON 数据块是完整备份数据，包含项目、任务、发生实例、表格/看板/甘特图/思维导图状态、来源、笔记和写入历史。`;
