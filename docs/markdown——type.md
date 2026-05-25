# Markdown 任务格式规范

本文件维护项目管理插件当前支持的 Markdown 格式。当前有两类格式：

1. 轻量 checklist 交换格式：由快速记录-创建任务、项目进度-批量导入、今日任务导出、项目 Markdown 导出共用。
2. 完整记录导出格式：由“导出全部记录”生成，用 Markdown 包裹完整 JSON，保证项目、表格、看板、甘特图、思维导图、来源、笔记和写入历史不丢失。

## 基本结构

```md
#项目：插件体验示例
- [ ] 开发任务解析器 kind:composite @2026-05-18 09:00-10:30 #parser !high status:doing
  - 解析标题 @09:10-09:40
  - 解析日期 @09:40-10:10
- [ ] 每日回顾输入流程 kind:simple @2026-05-18 20:00-20:20 #review status:todo repeat:daily count:5
- [x] 每周复盘导入流程 kind:simple @2026-05-18 20:30-21:00 #review status:done repeat:weekly count:4 finish:series
```

## 项目分组

| 写法 | 作用 |
| --- | --- |
| `#项目：项目名` | 后续任务归入该项目；项目不存在时会自动创建。 |
| `#项目：` | 后续任务导入为未归属任务。 |
| `#项目：未归属项目` | 等同于未归属任务，主要用于导出文本。 |

项目页批量导入在指定项目内打开时，未显式切换项目的任务会按当前项目处理。

## 任务行

任务行固定使用 Markdown checklist：

```md
- [ ] 任务标题 参数...
- [x] 已完成任务 参数...
```

`- [ ]` 表示未完成。`- [x]` 表示已勾选完成；重复任务默认只完成当前日期这一条发生，若要结束整个系列需写 `finish:series`。

## 参数

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `kind` / `type` | `kind:simple`、`kind:composite` | 任务类型。`simple` 为普通任务，`composite` 为组合任务。 |
| `@日期 时间` | `@2026-05-18 09:00-10:30` | 任务日期与可选时间段；不写时间则为未排期。 |
| `#标签` | `#parser` | 写入任务标签；可写多个。 |
| `!优先级` | `!low`、`!medium`、`!high`、`!urgent` | 写入任务优先级。 |
| `status` | `status:todo`、`status:doing`、`status:blocked`、`status:done` | 写入任务状态。 |
| `repeat` | `repeat:once`、`repeat:daily`、`repeat:weekly`、`repeat:custom` | 重复规则；未写时默认为 `once`。 |
| `count` | `count:5` | 重复次数；用于 `daily` / `weekly`。 |
| `until` | `until:2026-06-30` | 重复结束日期；用于 `daily` / `weekly`。 |
| `dates` | `dates:2026-05-18,2026-05-21` | 自定义发生日期集合；用于 `repeat:custom`。 |
| `finish` | `finish:today`、`finish:series` | 仅在 `- [x]` 时生效；`today` 完成当前日期，`series` 结束重复系列。 |

## 子任务

组合任务可在任务行下方缩进写子任务：

```md
- [ ] 组合任务 kind:composite @2026-05-18 14:00-15:00 status:todo
  - 子任务一 @14:10-14:30
  - 子任务二 @14:30-14:50
```

只要任务行下存在缩进子项，即使未显式写 `kind:composite`，导入时也会按组合任务处理。

组合任务的新规则：

1. 组合任务必须有开始时间和结束时间。
2. 轻量子任务可以只写标题；若写了 `@HH:mm-HH:mm`，必须完全落在组合任务时间范围内。
3. 挂入组合任务的真实任务也必须发生在组合任务实例的日期与时间范围内。

## 笔记同步块

全局 Markdown 笔记扫描只读取 `pm:start` 与 `pm:end` 之间的任务块：

```md
<!-- pm:start -->
#项目：插件体验示例
- [ ] 写解析器 kind:simple @2026-05-18 09:00-10:30 #plugin status:todo
<!-- pm:end -->
```

直接粘贴到快速记录或批量导入时，不需要包含这两行注释标记。

## 历史隔离

今天以前的任务发生记录不可被修改、删除、改时间或重新标记完成。编辑、删除、提前结束重复任务时，只会影响今天和未来发生记录；过去发生记录会保留旧版本。

例如：一个每日任务原本执行 30 次，过去已发生 10 次；今天把总次数改成 15 次后，过去 10 次仍保持旧记录，今天和未来只保留 5 次。

## 完整记录导出

“导出全部记录”按钮会生成完整 Markdown。前半段是可读摘要，后半段是完整 JSON 数据块：

````md
<!-- pm:full-export:start -->
```pm-project-management-json
{
  "format": "pm-project-management-full-export",
  "version": "0.4.0",
  "data": {
    "config": {},
    "projects": [],
    "progressPages": [],
    "tasks": [],
    "occurrences": [],
    "noteTaskIndex": [],
    "writeHistory": []
  }
}
```
<!-- pm:full-export:end -->
````

完整 JSON 是无损记录，包含：

1. 项目配置与项目列表。
2. 表格列配置与项目页排序。
3. 任务系列、发生实例、完成状态、轻量子任务时间。
4. 看板状态、甘特图状态、思维导图父子关系、评语节点与坐标。
5. 来源链接、任务笔记、全库同步索引、写入历史。

轻量 checklist 仍用于日常导入；完整记录导出用于备份、审计和学习当前数据结构。
