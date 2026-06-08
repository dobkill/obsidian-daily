import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ProjectManagementPlugin from "./main";
import { AppendHeaderConfig, PluginConfig } from "./types";
import { copyTextToClipboard } from "./utils/clipboard";
import { MARKDOWN_FORMAT_GUIDE } from "./utils/markdownGuide";

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
    doc.createEl("h3", { text: "快速记录格式规范" });
    doc.createDiv({
      cls: "pm-muted",
      text: "内容与 docs/markdown——type.md 和导出说明文件保持一致。"
    });
    this.renderMarkdownFormatGuide(doc);

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

  private renderMarkdownFormatGuide(containerEl: HTMLElement): void {
    const wrapper = containerEl.createDiv({ cls: "pm-settings-format-section" });
    const header = wrapper.createDiv({ cls: "pm-settings-format-header" });
    const copy = header.createDiv();
    copy.createEl("h4", { text: "完整 Markdown 说明" });
    copy.createDiv({ cls: "pm-muted", text: "可滚动查看所有格式规则、参数表和示例。" });
    const button = header.createEl("button", { text: "复制完整说明", cls: "pm-button pm-button-secondary" });
    const textarea = wrapper.createEl("textarea", {
      cls: "pm-settings-format-textarea pm-settings-format-guide-textarea",
      attr: { "aria-label": "快速记录格式完整说明", readonly: "true" }
    });
    textarea.value = MARKDOWN_FORMAT_GUIDE;
    button.addEventListener("click", async () => {
      await copyTextToClipboard(textarea.value);
      new Notice("已复制完整格式说明");
    });
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
