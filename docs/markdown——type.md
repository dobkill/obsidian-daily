# 快速记录格式规范

当前快速记录-创建任务支持三类输入格式。

1. 数据迁移 JSON：用于知识库迁移和完整恢复。
2. 今日完成极简 Markdown：用于完成今天已有任务。
3. 新任务计划复杂 Markdown：用于创建或覆盖任务计划。

## 数据迁移 JSON

“导出全部记录”复制的数据就是数据迁移 JSON。

```json
{
  "schema": "obsidian-project-management/data-migration",
  "version": 2,
  "exportedAt": "2026-05-26T12:00:00+08:00",
  "projects": [],
  "progressPages": [],
  "tasks": []
}
```

### 任务紧凑规则

1. `daily` / `weekly` 重复任务不导出逐日 `occurrenceDates`；由 `date`、`recurrence`、`recurrenceCount`、`recurrenceUntil` 推导。
2. 不规则日期写入 `occurrencePlan.include` 和 `occurrencePlan.exclude`。
3. 自定义日期写入 `occurrencePlan.dates` 或 `occurrencePlan.ranges`。
4. 空字段和默认视图状态不导出。
5. `occurrenceStates`、`occurrenceOverrides`、`viewState`、`mindmapComments`、`notes`、`sourceLinks` 保留完整业务状态。

### 恢复范围

导入数据迁移 JSON 会恢复项目、项目页、任务、看板状态、甘特属性、思维导图父子关系、评语、任务笔记、来源链接、重复发生日期、单次实例覆盖和完成状态。

## 今日完成极简 Markdown

今日任务页导出此格式：

```md
#项目：英语四级冲刺
- [ ] 每日背词
- [ ] 听力精听
```

把完成的任务改成 `[x]` 后粘回快速记录：

```md
#项目：英语四级冲刺
- [x] 每日背词
- [ ] 听力精听
```

规则：

1. `- [x] 标题` 只匹配同项目、同标题、今天发生的任务并完成当天实例。
2. `- [ ] 标题` 不创建任务，也不覆盖任务字段。
3. 找不到今日已有任务时会阻止导入。

## 新任务计划复杂 Markdown

复杂 Markdown 使用 `+ 任务：` 和 `+ 组合：`。

```md
#项目：英语四级冲刺
+ 任务：搭建复习看板 @2026-05-27 09:00-10:30 #planning !high status:doing
+ 组合：拆解每日背词 @2026-05-27 12:00-12:40 #vocab !medium status:todo repeat:daily count:5
  + 子任务：复习昨天错词 @2026-05-27 12:00-12:10 #vocab status:todo repeat:daily count:5
  + 子任务：新增 30 个高频词 @2026-05-27 12:10-12:30 #vocab status:todo repeat:daily count:5
  > 每天完成后可在今日任务页勾选。
```

规则：

1. 创建或覆盖任务必须提供完整 `@YYYY-MM-DD HH:mm-HH:mm`，时间范围为 `00:00` 至 `23:59`，结束时间必须晚于开始时间。
2. `#项目：项目名` 表示后续任务归入该项目；项目不存在时自动创建。
3. `#项目：` 或 `#项目：未归属项目` 表示未归属任务。
4. 项目页批量导入时，`#项目：` 必须等于当前项目；同项目同名任务会被覆盖计划字段并保留既有完成记录，否则创建新任务。
5. 时间冲突会自动调整到同日 1 分钟空档。

## 复杂 Markdown 参数

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `#标签` | `#planning` | 写入任务标签，可写多个。 |
| `!优先级` | `!low`、`!medium`、`!high`、`!urgent` | 写入任务优先级。 |
| `status` | `status:todo`、`status:doing`、`status:blocked`、`status:done` | 写入任务状态。 |
| `repeat` | `repeat:once`、`repeat:daily`、`repeat:weekly`、`repeat:custom` | 重复规则。 |
| `count` | `count:5` | 重复次数。 |
| `until` | `until:2026-06-30` | 重复结束日期。 |
| `dates` | `dates:2026-05-27,2026-05-29` | 自定义发生日期集合。 |
| `board` | `board:doing:10` | 看板列与排序。 |
| `gantt` | `gantt:order=10,locked,milestone` | 甘特图排序、锁定和里程碑。 |
| `deps` | `deps:%E4%BB%BB%E5%8A%A1A|%E4%BB%BB%E5%8A%A1B` | 甘特依赖，任务标题使用 URL 编码。 |
| `mindmap` | `mindmap:order=20,expanded,x=280,y=120` | 思维导图排序、展开状态和坐标。 |

## 组合任务

组合任务必须有开始与结束时间。子任务使用缩进的 `+ 子任务：`，它是独立普通任务，必须完整填写 `@YYYY-MM-DD HH:mm-HH:mm`，且发生日期和时间必须落在父组合任务范围内。复杂 Markdown 不保存完成记录；完整执行记录只通过数据迁移 JSON 保存。

## 笔记同步块

全库 Markdown 扫描只读取 `pm:start` 与 `pm:end` 之间的复杂 Markdown：

```md
<!-- pm:start -->
#项目：英语四级冲刺
+ 任务：听力精听 @2026-05-27 20:00-20:30 #listen status:todo
<!-- pm:end -->
```
