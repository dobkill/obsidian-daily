# Markdown 任务格式规范

本文件维护项目管理插件当前支持的 Markdown 任务交换格式。以下格式由快速记录-创建任务、项目进度-批量导入、今日任务导出、项目 Markdown 导出共用。

## 基本结构

```md
#项目：插件体验示例
- [ ] 开发任务解析器 kind:composite @2026-05-18 09:00-10:30 #parser !high status:doing
  - 解析标题
  - 解析日期
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
  - 子任务一
  - 子任务二
```

只要任务行下存在缩进子项，即使未显式写 `kind:composite`，导入时也会按组合任务处理。

## 笔记同步块

全局 Markdown 笔记扫描只读取 `pm:start` 与 `pm:end` 之间的任务块：

```md
<!-- pm:start -->
#项目：插件体验示例
- [ ] 写解析器 kind:simple @2026-05-18 09:00-10:30 #plugin status:todo
<!-- pm:end -->
```

直接粘贴到快速记录或批量导入时，不需要包含这两行注释标记。
