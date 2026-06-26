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

任务紧凑规则：

1. `daily`、`weekly`、`monthly` 可由 `date + recurrence + recurrenceCount/recurrenceUntil` 推导时，不导出完整日期数组。
2. 删除或补充过的实例写入 `occurrencePlan.include` 和 `occurrencePlan.exclude`。
3. 空字段和默认视图状态不导出。
4. `consumeRequiresCompletion`、`occurrenceStates`、`occurrenceOverrides`、`viewState`、`mindmapComments`、`notes`、`sourceLinks` 保留完整业务状态。

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

复杂 Markdown 使用 `+ 任务：`、`+ 组合：` 和缩进的 `+ 子任务：`。

```md
#项目：英语四级冲刺
+ 任务：搭建复习看板 @2026-05-27 09:00-10:30 !high status:doing
+ 任务：整理错题索引 @2026-05-28 status:todo
+ 组合：拆解每日背词 @2026-05-27 12:00-12:40 board:todo:0 gantt:order=20 mindmap:order=20,expanded
  + 子任务：复习昨天错词 @2026-05-27 12:00-12:10 status:todo repeat:daily count:5
  + 子任务：新增 30 个高频词 @2026-05-27 12:10-12:30 status:doing repeat:monthly count:5
  > 每天完成后可在今日任务页勾选。
```

规则：

1. `+ 任务：` 表示普通任务；必须写显式日期 `@YYYY-MM-DD`。可以写完整 `@YYYY-MM-DD HH:mm-HH:mm`，也可以只写日期表示未排期任务。
2. `+ 组合：` 表示容器；容器不支持状态和重复规则。
3. 缩进两个或更多空格的 `+ 子任务：` 必须写在某个 `+ 组合：` 下方；子任务是独立普通任务。
4. 时间范围为 `00:00` 至 `23:59`，结束时间必须晚于开始时间。
5. `#项目：项目名` 表示后续任务归入该项目；项目不存在时自动创建。
6. `#项目：` 或 `#项目：未归属项目` 表示未归属任务。
7. 项目页批量导入时，`#项目：` 必须等于当前项目；同项目同名任务会被覆盖计划字段并保留既有完成记录，否则创建新任务。
8. 时间冲突会自动调整到同日 1 分钟空档。
9. 缩进两个或更多空格的 `>` 行是任务描述，归入它前面最近的任务或子任务；多行描述会用换行连接。
10. 参数用空格分隔；任务标题是移除 `@日期`、`!优先级`、`status`、`repeat` 等参数后剩下的文本。

## 复杂 Markdown 参数

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `!优先级` | `!low`、`!medium`、`!high`、`!urgent` | 写入任务优先级。 |
| `status` | `status:todo`、`status:doing`、`status:blocked`、`status:done` | 写入普通任务或子任务状态。 |
| `repeat` | `repeat:daily`、`repeat:weekly`、`repeat:monthly` | 重复规则。 |
| `count` | `count:5` | 重复次数；单次任务使用 `count:1`。 |
| `until` | `until:2026-06-30` | 重复结束日期。 |
| `board` | `board:doing:10` | 看板列与排序。 |
| `gantt` | `gantt:order=10,locked,milestone` | 甘特图排序、锁定和里程碑。 |
| `deps` | `deps:%E4%BB%BB%E5%8A%A1A|%E4%BB%BB%E5%8A%A1B` | 甘特依赖，任务标题使用 URL 编码。 |
| `parent` | `parent:%E7%BB%84%E5%90%88%E4%BB%BB%E5%8A%A1A` | 挂入同项目下指定组合任务。 |
| `mindmap` | `mindmap:order=20,expanded,x=280,y=120` | 思维导图排序、展开状态和坐标。 |

## 重复规则补充

1. 不写 `repeat` 时默认为单次任务，即 `daily + count:1`。
2. 永久重复在弹窗中作为快捷选择保存为 `daily + count:2147483647`。
3. `consumeRequiresCompletion` 只通过弹窗和数据迁移 JSON 保存，复杂 Markdown 不写此字段。

## 笔记同步块

全库 Markdown 扫描只读取 `pm:start` 与 `pm:end` 之间的复杂 Markdown：

```md
<!-- pm:start -->
#项目：英语四级冲刺
+ 任务：听力精听 @2026-05-27 20:00-20:30 status:todo
<!-- pm:end -->
```
