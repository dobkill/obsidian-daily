import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { ProjectManagementStore } from "../storage/store";
import { recurrenceLabel } from "../domain/taskRules";

export type ImportSourceFormat = "data-migration" | "markdown-planned" | "markdown-minimal";

type BulkImportModalOptions = {
  title: string;
  store: ProjectManagementStore;
  projectId?: string;
  defaultDate: string;
  allowedFormats?: ImportSourceFormat[];
};

export class BulkImportModal extends Modal {
  private options: BulkImportModalOptions;

  constructor(app: App, options: BulkImportModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal", "pm-bulk-import-modal");
    contentEl.createEl("h2", { text: this.options.title });
    const projectName = this.options.projectId ? this.options.store.getProject(this.options.projectId)?.name ?? "当前项目" : "";

    const guideText = this.options.allowedFormats?.length === 1 && this.options.allowedFormats[0] === "markdown-planned"
      ? `当前处于项目导入模式：仅支持「新任务计划复杂 Markdown」格式。请使用「+ 任务：」或「+ 组合：」语法。`
      : this.options.projectId
        ? `当前处于项目导入模式：未显式切换项目时，任务会按「${projectName}」处理。也可粘贴「导出全部记录」的数据迁移 JSON。`
        : `支持 #项目：新项目名 自动建项目，也支持未归属任务；也可粘贴「导出全部记录」的数据迁移 JSON。`;

    contentEl.createDiv({
      cls: "pm-import-guide",
      text: guideText
    });

    const state = {
      text: "",
      defaultDate: this.options.defaultDate
    };

    new Setting(contentEl)
      .setName("默认日期")
      .addText((text) =>
        text.setValue(state.defaultDate).onChange((value) => {
          state.defaultDate = value.trim();
          renderPreview();
        })
      );

    const input = contentEl.createEl("textarea", {
      cls: "pm-bulk-import-input",
      placeholder:
        "#项目：插件体验示例\n+ 组合：开发任务解析器 @2026-05-18 09:00-10:30\n  + 子任务：解析标题 @2026-05-18 09:05-09:30 status:todo\n  + 子任务：解析日期 @2026-05-18 09:30-10:00 status:todo\n+ 任务：每日回顾输入流程 @2026-05-18 20:00-20:20 status:todo repeat:daily count:5\n+ 任务：月度复盘导入流程 @2026-05-18 20:30-21:00 status:todo repeat:monthly count:4"
    });
    input.addEventListener("input", () => {
      state.text = input.value;
      renderPreview();
    });

    let currentFormatBlocked = false;
    const previewEl = contentEl.createDiv({ cls: "pm-import-preview" });
    const renderPreview = (): void => {
      previewEl.empty();
      const preview = this.options.store.previewFormattedTasks(state.text, {
        projectId: this.options.projectId,
        strictProjectId: this.isProjectMarkdownOnlyMode() ? this.options.projectId : undefined,
        defaultDate: state.defaultDate
      });

      currentFormatBlocked = this.isFormatBlocked(preview.sourceFormat);

      if (currentFormatBlocked) {
        previewEl.createDiv({
          cls: "pm-import-format-warning",
          text: this.getFormatBlockedMessage()
        });
      }

      previewEl.createDiv({
        cls: "pm-muted",
        text: `解析 ${preview.summary.total} 条，问题 ${preview.issues.length} 条`
      });
      const summaryGrid = previewEl.createDiv({ cls: "pm-import-summary-grid" });
      const summaryItems =
        preview.sourceFormat === "data-migration" && preview.dataMigration
          ? [
              ["记录类型", "数据迁移 JSON"],
              ["项目", String(preview.dataMigration.projects)],
              ["项目页", String(preview.dataMigration.progressPages)],
              ["任务 / 实例", `${preview.dataMigration.tasks} / ${preview.dataMigration.occurrences}`],
              ["导图关系", String(preview.dataMigration.mindmapLinks)],
              ["新增 / 覆盖", `${preview.summary.createCount} / ${preview.summary.overwriteCount}`]
            ]
          : [
              ["新增任务", String(preview.summary.createCount)],
              ["覆盖任务", String(preview.summary.overwriteCount)],
              ["完成今日", String(preview.summary.completeTodayCount)],
              ["提前结束", String(preview.summary.completeSeriesCount)],
              ["组合任务", String(preview.summary.composite)],
              ["已勾选完成", String(preview.summary.completed)]
            ];
      summaryItems.forEach(([label, value]) => {
        const card = summaryGrid.createDiv({ cls: "pm-import-summary-card" });
        card.createDiv({ cls: "pm-muted", text: label });
        card.createEl("strong", { text: value });
      });
      if (preview.summary.newProjectNames.length > 0) {
        previewEl.createDiv({
          cls: "pm-import-project-hint",
          text: `将自动新建项目：${preview.summary.newProjectNames.join("、")}`
        });
      }
      if (preview.tasks.length > 0) {
        const list = previewEl.createEl("ul", { cls: "pm-import-preview-list" });
        preview.tasks.slice(0, 12).forEach((task) => {
          const line = [
            importActionText(task.action),
            task.input.kind === "composite" ? "组合任务" : "普通任务",
            recurrenceLabel(task.input.recurrence),
            task.projectName ?? "未归属项目",
            task.input.completed ? "已勾选完成" : task.input.status === "doing" ? "进行中" : task.input.status === "blocked" ? "阻塞" : "待办",
            task.input.date,
            task.input.startTime && task.input.endTime ? `${task.input.startTime}-${task.input.endTime}` : "未排期"
          ].join(" · ");
          list.createEl("li", { text: `${task.input.title} · ${line}` });
        });
      }
      if (preview.issues.length > 0) {
        const issueList = previewEl.createEl("ul", { cls: "pm-import-issues" });
        preview.issues.slice(0, 8).forEach((issue) => {
          issueList.createEl("li", { text: `第 ${issue.line} 行：${issue.message}${issue.blocking ? "（阻止导入）" : ""}` });
        });
      }

      importButton.setDisabled(currentFormatBlocked);
    };

    const footer = contentEl.createDiv({ cls: "pm-modal-actions" });
    const importButton = new ButtonComponent(footer)
      .setButtonText("导入")
      .setCta()
      .onClick(async () => {
        try {
          if (currentFormatBlocked) {
            new Notice(this.getFormatBlockedMessage());
            return;
          }
          const created = await this.options.store.importFormattedTasks(state.text, {
            projectId: this.options.projectId,
            strictProjectId: this.isProjectMarkdownOnlyMode() ? this.options.projectId : undefined,
            defaultDate: state.defaultDate
          });
          new Notice(`已处理 ${created.length} 条任务`);
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "导入失败");
        }
      });
    new ButtonComponent(footer).setButtonText("取消").onClick(() => this.close());
    renderPreview();
  }

  private isFormatBlocked(sourceFormat: string): boolean {
    if (!this.options.allowedFormats) {
      return false;
    }
    return !this.options.allowedFormats.includes(sourceFormat as ImportSourceFormat);
  }

  private isProjectMarkdownOnlyMode(): boolean {
    return this.options.allowedFormats?.length === 1 && this.options.allowedFormats[0] === "markdown-planned" && Boolean(this.options.projectId);
  }

  private getFormatBlockedMessage(): string {
    if (this.options.allowedFormats?.length === 1 && this.options.allowedFormats[0] === "markdown-planned") {
      return "当前仅支持「新任务计划复杂 Markdown」格式，请使用 + 任务：或 + 组合：语法";
    }
    return "当前不支持此导入格式";
  }
}

function importActionText(action: "create" | "overwrite" | "complete-today" | "complete-series"): string {
  if (action === "complete-series") {
    return "完成并结束系列";
  }
  if (action === "complete-today") {
    return "完成今日";
  }
  if (action === "overwrite") {
    return "覆盖";
  }
  return "新增";
}
