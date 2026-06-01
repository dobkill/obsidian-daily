import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DATA_MIGRATION_SCHEMA, DATA_MIGRATION_VERSION } from "./importExport/dataMigration";
import type ProjectManagementPlugin from "./main";
import { AppendHeaderConfig, PluginConfig } from "./types";
import { copyTextToClipboard } from "./utils/clipboard";

const DATA_MIGRATION_SAMPLE_TEXT = JSON.stringify(
  {
    schema: DATA_MIGRATION_SCHEMA,
    version: DATA_MIGRATION_VERSION,
    exportedAt: "2026-05-26T12:00:00+08:00",
    projects: [
      {
        id: "project-english",
        name: "英语四级冲刺",
        description: "迁移 JSON 会保留项目元数据。",
        color: "#3d8bfd",
        status: "active",
        createdAt: "2026-05-26T12:00:00+08:00",
        updatedAt: "2026-05-26T12:00:00+08:00"
      }
    ],
    progressPages: [
      {
        id: "page-english",
        projectId: "project-english",
        name: "英语四级冲刺",
        columnOrder: ["title", "status", "priority", "tags", "recurrence", "schedule", "completion", "description", "actions"],
        createdAt: "2026-05-26T12:00:00+08:00",
        updatedAt: "2026-05-26T12:00:00+08:00"
      }
    ],
    tasks: [
      {
        id: "task-vocab",
        title: "每日背词",
        projectId: "project-english",
        date: "2026-05-26",
        startTime: "07:00",
        endTime: "07:30",
        recurrence: "daily",
        recurrenceCount: 1000,
        occurrenceStates: [{ date: "2026-05-26", completedAt: "2026-05-26T07:31:00+08:00" }],
        viewState: { board: { columnId: "todo", order: 10 }, gantt: { rowOrder: 10, dependencyIds: [], locked: false, milestone: false }, mindmap: { parentTaskId: null, childOrder: 10, expanded: true } },
        createdAt: "2026-05-26T12:00:00+08:00",
        updatedAt: "2026-05-26T12:00:00+08:00",
        revision: 1
      }
    ]
  },
  null,
  2
);

const TODAY_COMPLETION_SAMPLE_TEXT = [
  "#项目：英语四级冲刺",
  "- [x] 每日背词",
  "- [ ] 听力精听",
  "",
  "#项目：未归属项目",
  "- [x] 购买答题卡"
].join("\n");

const TASK_PLAN_SAMPLE_TEXT = [
  "#项目：英语四级冲刺",
  "+ 任务：搭建复习看板 @2026-05-27 09:00-10:30 #planning !high status:doing",
  "+ 组合：拆解每日背词 @2026-05-27 12:00-12:40 #vocab !medium status:todo repeat:daily count:5",
  "  + 子任务：复习昨天错词 @2026-05-27 12:00-12:10 #vocab status:todo repeat:daily count:5",
  "  + 子任务：新增 30 个高频词 @2026-05-27 12:10-12:30 #vocab status:todo repeat:daily count:5",
  "  > 每天完成后可在今日任务页勾选。",
  "+ 任务：模考复盘 @2026-05-29 19:30-21:00 #mock status:todo repeat:weekly count:4"
].join("\n");

type FormatGuideSection = {
  title: string;
  desc: string;
  points: string[];
  sample: string;
};

const FORMAT_GUIDE_SECTIONS: FormatGuideSection[] = [
  {
    title: "数据迁移 JSON",
    desc: "用于知识库迁移和完整恢复，由“导出全部记录”生成，也可直接粘贴到快速记录-创建任务。",
    points: [
      "保留项目、项目页、任务、看板、甘特图、思维导图、评语、任务笔记、完成状态和单次实例覆盖。",
      "重复日期不逐日展开；每日 / 每周任务用 recurrence + count / until 表达，异常日期才写入 occurrencePlan。",
      "必须保持 schema 与 version 不变。"
    ],
    sample: DATA_MIGRATION_SAMPLE_TEXT
  },
  {
    title: "今日完成极简 Markdown",
    desc: "用于把今日任务页导出的清单粘回快速记录，只改变今天已有任务的完成状态。",
    points: [
      "只支持 #项目 分组和 - [x] 标题 / - [ ] 标题。",
      "不会创建新任务，也不会覆盖任务日期、时间、标签或重复规则。",
      "找不到同项目、同标题、今天发生的任务时会阻止导入。"
    ],
    sample: TODAY_COMPLETION_SAMPLE_TEXT
  },
  {
    title: "新任务计划复杂 Markdown",
    desc: "用于制定新计划或覆盖已有任务，语法与今日完成格式明显分离。",
    points: [
      "任务行使用 + 任务：或 + 组合：开头，创建 / 覆盖必须提供 @YYYY-MM-DD HH:mm-HH:mm，时间范围为 00:00 至 23:59。",
      "支持 #标签、!优先级、status、repeat、count、until、dates、board、gantt、deps、mindmap 和缩进描述。",
      "组合任务的子任务使用缩进的 + 子任务：，子任务是独立普通任务，不能是组合任务。"
    ],
    sample: TASK_PLAN_SAMPLE_TEXT
  }
];

export class ProjectManagementSettingTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "项目管理插件设置" });
    const doc = containerEl.createDiv({ cls: "pm-settings-doc" });
    doc.createEl("h3", { text: "快速记录三种创建格式" });
    doc.createDiv({
      cls: "pm-muted",
      text: "示例窗口可编辑、可滚动、可复制，但不会保存；每次重新打开设置页都会恢复默认内容。"
    });
    FORMAT_GUIDE_SECTIONS.forEach((section) => this.renderFormatGuideSection(doc, section));

    new Setting(containerEl)
      .setName("导出 Markdown 语法说明")
      .setDesc("生成一份当前插件支持的快速记录格式说明，包含数据迁移 JSON 与两类 Markdown。")
      .addButton((button) =>
        button.setButtonText("导出说明文件").setCta().onClick(async () => {
          const path = await this.plugin.store.exportMarkdownGuide();
          new Notice(`已导出到 ${path}`);
        })
      );

    new Setting(containerEl)
      .setName("数据目录路径")
      .setDesc("必须是当前 Vault 内相对路径。目标目录已有有效插件数据时会直接加载；目录不存在、为空或插件数据损坏时会用当前数据创建新文件。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dataFolder).onChange(async (value) => {
          this.plugin.pendingSettings.dataFolder = value.trim();
        })
      )
      .addButton((button) =>
        button.setButtonText("应用").setCta().onClick(async () => {
          const path = this.plugin.pendingSettings.dataFolder ?? this.plugin.settings.dataFolder;
          const validation = await this.plugin.store.validateDataFolder(path);
          if (!validation.ok) {
            new Notice(validation.message ?? "数据目录不可用");
            return;
          }
          await this.plugin.updateSettings({ dataFolder: path });
          new Notice("数据目录已更新");
        })
      );

    new Setting(containerEl)
      .setName("活跃度 Tab 名称")
      .addText((text) =>
        text.setValue(this.plugin.settings.overviewTab1Name).onChange(async (value) => {
          await this.plugin.updateSettings({ overviewTab1Name: value.trim() || "活跃度" });
        })
      );

    new Setting(containerEl)
      .setName("项目进度 Tab 名称")
      .addText((text) =>
        text.setValue(this.plugin.settings.overviewTab2Name).onChange(async (value) => {
          await this.plugin.updateSettings({ overviewTab2Name: value.trim() || "项目进度" });
        })
      );

    new Setting(containerEl)
      .setName("快速记录页名称")
      .addText((text) =>
        text.setValue(this.plugin.settings.dialogTabName).onChange(async (value) => {
          await this.plugin.updateSettings({ dialogTabName: value.trim() || "快速记录" });
        })
      );

    new Setting(containerEl)
      .setName("日记文件夹")
      .setDesc("按天生成日记时使用的 Vault 内相对路径。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyNoteFolder).onChange(async (value) => {
          await this.plugin.updateSettings({ dailyNoteFolder: value.trim() || "日记" });
        })
      );

    new Setting(containerEl)
      .setName("日记文件名日期格式")
      .setDesc("支持 YYYY、MM、DD、HH、mm、ss，例如 YYYY-MM-DD。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyNoteDateFormat).onChange(async (value) => {
          await this.plugin.updateSettings({ dailyNoteDateFormat: value.trim() || "YYYY-MM-DD" });
        })
      );

    new Setting(containerEl)
      .setName("日记保存方式")
      .setDesc("默认每天一个文件；也可以把快速记录统一追加到一个汇总文件。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("per-day", "每天一个文件")
          .addOption("single-file", "汇总到单文件")
          .setValue(this.plugin.settings.dailyNoteMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ dailyNoteMode: value as typeof this.plugin.settings.dailyNoteMode });
          });
      });

    new Setting(containerEl)
      .setName("日记汇总文件")
      .setDesc("日记保存方式为“汇总到单文件”时使用，例如：日记/快速记录.md。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyNoteSingleFilePath).onChange(async (value) => {
          await this.plugin.updateSettings({ dailyNoteSingleFilePath: value.trim() || "日记/快速记录.md" });
        })
      );

    this.renderAppendHeaderSettings(containerEl, "笔记追加头", "用于快速记录-追加笔记写入任意 Markdown 文件。", "noteAppendHeader");
    this.renderAppendHeaderSettings(containerEl, "日记插入头", "用于快速记录-写日记写入每日文件或汇总文件。", "dailyNoteHeader");

    new Setting(containerEl)
      .setName("最近笔记数量")
      .setDesc("当最近操作记录不足时，用于补充最近修改文件候选；快捷区固定展示最近 10 个操作文件。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.taskNoteRecentLimit)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) {
            await this.plugin.updateSettings({ taskNoteRecentLimit: Math.min(30, Math.floor(parsed)) });
          }
        })
      );

    new Setting(containerEl)
      .setName("快速记录默认目标")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("daily-note", "写入每日日记")
          .addOption("task-note", "追加到任务笔记")
          .addOption("quick-task", "快速创建任务")
          .addOption("mindmap", "扩充思维导图")
          .setValue(this.plugin.settings.defaultDialogTarget)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ defaultDialogTarget: value as typeof this.plugin.settings.defaultDialogTarget });
          });
      });

    new Setting(containerEl)
      .setName("时间粒度")
      .setDesc("MVP 默认 15 分钟")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.timeSlotMinutes)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) {
            await this.plugin.updateSettings({ timeSlotMinutes: parsed });
          }
        })
      );

    new Setting(containerEl)
      .setName("默认任务时长")
      .setDesc("单位：分钟")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.defaultTaskDurationMinutes)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) {
            await this.plugin.updateSettings({ defaultTaskDurationMinutes: parsed });
          }
        })
      );

    new Setting(containerEl)
      .setName("默认开始时间")
      .setDesc("当某一天尚无已排期任务时，新增任务默认从该时间开始")
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultTaskStartTime).onChange(async (value) => {
          if (/^\d{2}:\d{2}$/.test(value.trim())) {
            await this.plugin.updateSettings({ defaultTaskStartTime: value.trim() });
          }
        })
      );

    new Setting(containerEl)
      .setName("显示已完成任务")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showCompletedTasks).onChange(async (value) => {
          await this.plugin.updateSettings({ showCompletedTasks: value });
        })
      );
  }

  private renderFormatGuideSection(containerEl: HTMLElement, section: FormatGuideSection): void {
    const wrapper = containerEl.createDiv({ cls: "pm-settings-format-section" });
    const header = wrapper.createDiv({ cls: "pm-settings-format-header" });
    const copy = header.createDiv();
    copy.createEl("h4", { text: section.title });
    copy.createDiv({ cls: "pm-muted", text: section.desc });
    const button = header.createEl("button", { text: "复制范例", cls: "pm-button pm-button-secondary" });
    const textarea = wrapper.createEl("textarea", { cls: "pm-settings-format-textarea" });
    textarea.value = section.sample;
    button.addEventListener("click", async () => {
      await copyTextToClipboard(textarea.value);
      new Notice(`已复制${section.title}范例`);
    });
    const list = wrapper.createEl("ul", { cls: "pm-settings-format-points" });
    section.points.forEach((point) => list.createEl("li", { text: point }));
  }

  private renderAppendHeaderSettings(
    containerEl: HTMLElement,
    title: string,
    description: string,
    key: "noteAppendHeader" | "dailyNoteHeader"
  ): void {
    const wrapper = containerEl.createDiv({ cls: "pm-settings-group" });
    wrapper.createEl("h3", { text: title });
    wrapper.createDiv({ cls: "pm-muted", text: description });
    const current = this.plugin.settings[key];
    const update = async (patch: Partial<AppendHeaderConfig>): Promise<void> => {
      const next = { ...this.plugin.settings[key], ...patch };
      await this.plugin.updateSettings({ [key]: next } as Partial<PluginConfig>);
    };

    new Setting(wrapper)
      .setName("启用插入头")
      .addToggle((toggle) => toggle.setValue(current.enabled).onChange(async (value) => update({ enabled: value })));

    new Setting(wrapper)
      .setName("包含时间")
      .addToggle((toggle) => toggle.setValue(current.includeTime).onChange(async (value) => update({ includeTime: value })));

    new Setting(wrapper)
      .setName("标题级别")
      .setDesc("1 到 6，对应 Markdown 标题层级。")
      .addText((text) =>
        text.setValue(String(current.headingLevel)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            await update({ headingLevel: Math.min(6, Math.max(1, Math.floor(parsed))) });
          }
        })
      );

    new Setting(wrapper)
      .setName("日期格式")
      .setDesc("支持 YYYY、MM、DD。")
      .addText((text) => text.setValue(current.dateFormat).onChange(async (value) => update({ dateFormat: value.trim() || "YYYY-MM-DD" })));

    new Setting(wrapper)
      .setName("时间格式")
      .setDesc("支持 HH、mm、ss。")
      .addText((text) => text.setValue(current.timeFormat).onChange(async (value) => update({ timeFormat: value.trim() || "HH:mm:ss" })));

    new Setting(wrapper)
      .setName("日期时间分隔符")
      .addText((text) => text.setValue(current.separator).onChange(async (value) => update({ separator: value })));

    new Setting(wrapper)
      .setName("前缀特殊文字")
      .addText((text) => text.setValue(current.prefix).onChange(async (value) => update({ prefix: value })));

    new Setting(wrapper)
      .setName("后缀特殊文字")
      .addText((text) => text.setValue(current.suffix).onChange(async (value) => update({ suffix: value })));
  }
}
