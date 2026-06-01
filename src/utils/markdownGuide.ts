export const MARKDOWN_FORMAT_GUIDE = `# 快速记录格式说明

本说明对应当前插件实现。快速记录-创建任务只接收三类格式：数据迁移 JSON、今日完成极简 Markdown、新任务计划复杂 Markdown。

## 数据迁移 JSON

数据迁移 JSON 由“项目进度 - 导出全部记录”生成，用于知识库迁移和完整恢复。

\`\`\`json
{
  "schema": "obsidian-project-management/data-migration",
  "version": 2,
  "exportedAt": "2026-05-26T12:00:00+08:00",
  "projects": [],
  "progressPages": [],
  "tasks": []
}
\`\`\`

规则：

- JSON 可直接粘贴到“快速记录 - 创建任务”。
- 每日 / 每周重复任务通过 \`recurrence\`、\`recurrenceCount\`、\`recurrenceUntil\` 表达，不逐日导出重复日期。
- 不规则发生日期写入 \`occurrencePlan.include\` / \`occurrencePlan.exclude\`，自定义重复写入 \`occurrencePlan.dates\` 或 \`occurrencePlan.ranges\`。
- 任务完成、组合任务部分完成、单次实例覆盖、看板、甘特图、思维导图、评语、任务笔记和来源链接都保存在 JSON 内。

## 今日完成极简 Markdown

今日任务页导出的格式只用于完成今天已有任务。

\`\`\`md
#项目：英语四级冲刺
- [x] 每日背词
- [ ] 听力精听
\`\`\`

规则：

- \`- [x] 标题\` 只匹配同项目、同标题、今天发生的任务并完成当天实例。
- \`- [ ] 标题\` 不创建任务，也不覆盖字段。
- 找不到今日已有任务时会报错。

## 新任务计划复杂 Markdown

新计划使用 \`+ 任务：\` 或 \`+ 组合：\`，与今日完成格式分离。

\`\`\`md
#项目：英语四级冲刺
+ 任务：搭建复习看板 @2026-05-27 09:00-10:30 #planning !high status:doing
+ 组合：拆解每日背词 @2026-05-27 12:00-12:40 #vocab status:todo repeat:daily count:5
  + 子任务：复习昨天错词 @2026-05-27 12:00-12:10 #vocab status:todo repeat:daily count:5
  + 子任务：新增 30 个高频词 @2026-05-27 12:10-12:30 #vocab status:todo repeat:daily count:5
  > 每天完成后可在今日任务页勾选。
\`\`\`

规则：

- 创建或覆盖任务必须提供 \`@YYYY-MM-DD HH:mm-HH:mm\`，时间范围为 \`00:00\` 至 \`23:59\`，结束时间必须晚于开始时间。
- \`#项目：项目名\` 表示后续任务归入该项目；项目不存在时自动创建。
- \`#项目：\` 或 \`#项目：未归属项目\` 表示未归属任务。
- 项目页批量导入时，\`#项目：\` 必须等于当前项目；同项目同名任务会覆盖计划字段，但保留既有完成记录。
- 组合任务下方可缩进写 \`+ 子任务：\`。子任务是独立普通任务，保留自己的重复规则和完成状态，不能是组合任务。

## 复杂 Markdown 参数

- \`#标签\`：写入任务标签，可写多个。
- \`!low | !medium | !high | !urgent\`：优先级。
- \`status:todo | doing | blocked | done\`：看板状态。
- \`repeat:once | daily | weekly | custom\`：重复类型。
- \`count:N\`：重复次数。
- \`until:YYYY-MM-DD\`：重复结束日期。
- \`dates:YYYY-MM-DD,YYYY-MM-DD\`：自定义发生日期。
- \`board:doing:10\`：看板列与排序。
- \`gantt:order=10,locked,milestone\`：甘特图排序、锁定和里程碑。
- \`deps:%E4%BB%BB%E5%8A%A1A|%E4%BB%BB%E5%8A%A1B\`：甘特依赖，任务标题使用 URL 编码。
- \`mindmap:order=20,expanded,x=280,y=120\`：思维导图排序、展开状态和坐标。

新任务计划复杂 Markdown 不保存完成记录；完整执行记录只通过数据迁移 JSON 保存。组合任务必须有开始与结束时间，挂入的子任务必须落在组合任务日期和时间范围内。`;
