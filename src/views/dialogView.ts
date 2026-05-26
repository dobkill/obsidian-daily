import { Notice, TFile, TFolder, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { EntitySuggestModal } from "../components/entitySuggestModal";
import type ProjectManagementPlugin from "../main";
import { AppendHeaderConfig, DialogTarget, Task } from "../types";
import { formatDateTimePattern, now, toDateKey } from "../utils/date";
import { BaseProjectView } from "./base";

export const DIALOG_VIEW_TYPE = "project-management-dialog-view";

type MindmapInsertMode = "inside" | "child";

type QuickTargetCard = {
  value: DialogTarget;
  label: string;
  desc: string;
  icon: string;
};

type MindmapAnchorOption = {
  taskId: string;
  commentId: string | null;
  projectId: string;
  label: string;
  note: string;
  taskTitle: string;
  pathLabel: string;
  kind: "task" | "comment";
};

type MindmapProjectOption = {
  id: string;
  label: string;
  note: string;
};

type RecentMindmapTarget = {
  taskId: string;
  commentId: string | null;
};

export class QuickDialogView extends BaseProjectView {
  private static recentMindmapTargets: RecentMindmapTarget[] = [];

  private target: DialogTarget = "daily-note";
  private selectedMindmapProjectId = "";
  private selectedTaskId = "";
  private selectedCommentId = "";
  private selectedNotePath = "";
  private draftContent = "";
  private mindmapInsertMode: MindmapInsertMode = "child";

  constructor(leaf: WorkspaceLeaf, plugin: ProjectManagementPlugin) {
    super(leaf, plugin);
    this.target = plugin.settings.defaultDialogTarget;
  }

  getViewType(): string {
    return DIALOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.settings.dialogTabName;
  }

  getIcon(): string {
    return "message-square-plus";
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("pm-view", "pm-dialog-view");

    const tasks = sortTasksForMindmapSelection(this.plugin.store.getAllTasks(), (task) => this.projectNameForTask(task));
    const allNoteFiles = this.getAllMarkdownFiles();
    const recentNoteFiles = this.getRecentNoteFiles(allNoteFiles);
    const mindmapProjects = buildMindmapProjectOptions(tasks, (task) => this.projectNameForTask(task));
    this.ensureDialogSelections(tasks, allNoteFiles, recentNoteFiles, mindmapProjects);
    const projectTasks = this.selectedMindmapProjectId
      ? tasks.filter((task) => mindmapProjectKey(task) === this.selectedMindmapProjectId)
      : [];
    const projectNodeOptions = buildMindmapAnchorOptions(projectTasks);
    const selectedNode = this.ensureMindmapNodeSelection(projectNodeOptions);
    const recentNodeOptions = this.resolveRecentMindmapTargets(buildMindmapAnchorOptions(tasks));

    const header = container.createDiv({ cls: "pm-page-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "快速记录" });
    title.createDiv({ cls: "pm-muted", text: "快速记录、写日记、追加任意笔记，或给思维导图补充评语。" });

    const targetCards = container.createDiv({ cls: "pm-dialog-tabs pm-segmented-control" });
    getTargetCards().forEach((item) => {
      const card = targetCards.createEl("button", {
        cls: `pm-dialog-tab pm-segmented-item ${this.target === item.value ? "is-active" : ""}`
      });
      card.dataset.target = item.value;
      const icon = card.createSpan({ cls: "pm-dialog-tab-icon" });
      setIcon(icon, item.icon);
      card.createSpan({ cls: "pm-dialog-tab-title", text: item.label });
      card.addEventListener("click", () => {
        this.target = item.value;
        this.render();
      });
    });

    if (this.target === "daily-note") {
      this.renderPathCard(container, {
        icon: "calendar-days",
        title: "写入位置",
        path: this.resolveDailyNotePath(),
        muted: this.plugin.settings.dailyNoteMode === "single-file" ? "单文件模式" : "按日生成 Markdown 文件"
      });
    }

    if (this.target === "task-note") {
      this.renderTaskNoteControls(container, allNoteFiles, recentNoteFiles);
    }

    if (this.target === "mindmap") {
      this.renderMindmapControls(container, mindmapProjects, projectNodeOptions, recentNodeOptions, selectedNode);
    }

    if (this.target === "quick-task") {
      const importHint = container.createDiv({ cls: "pm-input-card" });
      const hintHeader = importHint.createDiv({ cls: "pm-input-card-header" });
      hintHeader.createEl("strong", { text: "创建任务格式" });
      hintHeader.createDiv({ cls: "pm-muted", text: "数据迁移 JSON、今日完成极简 Markdown、新任务计划复杂 Markdown 会自动分流。" });
      [
        "支持粘贴“导出全部记录”的数据迁移 JSON；提交后会恢复项目、项目页、任务视图状态和导图关系。",
        "新任务计划使用 + 任务：或 + 组合：开头，必须写完整日期和时间段。",
        "今日完成只使用极简 - [x] 标题；找不到今日已有任务会报错，不会创建新任务。",
        "组合计划可直接在下一行缩进写轻量项。",
        "任务行下缩进 > 描述 可写入任务描述，多行描述会按换行合并。",
        "支持单次、每日、每周此时：repeat:once / daily / weekly；需要限制次数可继续写 count:4 或 until:2026-06-30。",
        "支持 done:2026-05-25,2026-05-26 标记已完成发生日期，用于计划文本中的局部完成记录。"
      ].forEach((item) => importHint.createDiv({ cls: "pm-settings-note-item", text: item }));
    }

    const editorCard = container.createDiv({ cls: "pm-editor-card" });
    const editorHeader = editorCard.createDiv({ cls: "pm-editor-header" });
    const editorCopy = editorHeader.createDiv();
    editorCopy.createEl("h3", { text: "内容编辑" });
    editorCopy.createDiv({ cls: "pm-muted", text: editorHint(this.target, this.mindmapInsertMode) });

    const textarea = editorCard.createEl("textarea", {
      cls: "pm-dialog-input",
      placeholder: this.placeholderForTarget()
    });
    textarea.value = this.draftContent;
    const updateEditorCount = (): void => {
      this.draftContent = textarea.value;
      const counter = editorCard.querySelector(".pm-editor-count");
      if (counter instanceof HTMLElement) {
        counter.setText(`字数：${this.draftContent.length}`);
      }
    };
    textarea.addEventListener("input", updateEditorCount);
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitButton.click();
      }
    });

    const toolbar = editorCard.createDiv({ cls: "pm-editor-toolbar" });
    if (this.target === "quick-task") {
      toolbar.addClass("is-task-toolbar");
      buildQuickTaskShortcuts().forEach((item) => {
        const button = toolbar.createEl("button", { text: item.label, cls: "pm-button pm-button-secondary pm-editor-tool" });
        button.title = item.hint;
        button.addEventListener("click", () => {
          insertQuickTaskSnippet(textarea, item.snippet);
          updateEditorCount();
        });
      });
    } else {
      const toolActions: Array<{ label: string; action: ToolbarAction }> = [
        { label: "B", action: "bold" },
        { label: "I", action: "italic" },
        { label: "H", action: "heading" },
        { label: "列表", action: "list" },
        { label: "引用", action: "quote" },
        { label: "代码", action: "code" }
      ];
      toolActions.forEach((item) => {
        const button = toolbar.createEl("button", { text: item.label, cls: "pm-button pm-button-ghost pm-editor-tool" });
        button.addEventListener("click", () => {
          applyEditorFormat(textarea, item.action);
          updateEditorCount();
        });
      });
    }

    if (this.target === "quick-task") {
      this.renderQuickTaskPreview(editorCard, textarea);
    }

    const footer = editorCard.createDiv({ cls: "pm-editor-footer" });
    footer.createDiv({ cls: "pm-editor-count pm-muted", text: `字数：${this.draftContent.length}` });
    const submitButton = footer.createEl("button", { text: "提交内容", cls: "pm-button pm-button-primary" });
    submitButton.setAttribute("aria-keyshortcuts", "Ctrl+Enter Meta+Enter");
    submitButton.addEventListener("click", async () => {
      try {
        await this.submit(this.draftContent, tasks);
        this.draftContent = "";
        textarea.value = "";
        footer.querySelector(".pm-editor-count")?.setText("字数：0");
        new Notice("已保存");
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  private renderTaskNoteControls(container: HTMLElement, allFiles: TFile[], recentFiles: TFile[]): void {
    const pathCard = this.renderPathCard(container, {
      icon: "file-text",
      title: "目标文件",
      path: this.selectedNotePath || "请选择 Markdown 文件",
      muted: "支持全库按文件名相似度检索，并保留最近 10 个操作文件快捷追加。"
    });
    pathCard.querySelector(".pm-path-value")?.setAttribute("title", this.selectedNotePath || "请选择 Markdown 文件");
    const actions = pathCard.createDiv({ cls: "pm-path-actions" });
    const pickerButton = actions.createEl("button", { cls: "pm-button pm-button-secondary pm-path-button" });
    setIcon(pickerButton, "folder-open");
    pickerButton.title = "选择文件";
    pickerButton.addEventListener("click", () => {
      new EntitySuggestModal<TFile>(this.app, {
        items: allFiles,
        placeholder: "按文件名搜索整个 Vault",
        emptyStateText: "没有可选的 Markdown 文件",
        getItemText: (file) => file.basename,
        getItemNote: (file) => file.path,
        onChoose: (file) => {
          this.selectedNotePath = file.path;
          this.render();
        }
      }).open();
    });

    const recentCard = container.createDiv({ cls: "pm-input-card" });
    const recentHeader = recentCard.createDiv({ cls: "pm-input-card-header" });
    recentHeader.createEl("strong", { text: "最近 10 个操作文件" });
    recentHeader.createDiv({ cls: "pm-muted", text: "点击即可切换为当前追加目标。" });
    const recentList = recentCard.createDiv({ cls: "pm-anchor-chip-list pm-anchor-shortcut-list" });
    if (recentFiles.length === 0) {
      recentList.createDiv({ cls: "pm-muted", text: "还没有最近操作记录，首次追加后会出现在这里。" });
      return;
    }
    recentFiles.slice(0, 10).forEach((file) => {
      const chip = recentList.createEl("button", {
        cls: `pm-anchor-chip pm-anchor-shortcut ${file.path === this.selectedNotePath ? "is-active" : ""}`
      });
      chip.title = file.path;
      chip.createSpan({ cls: "pm-anchor-shortcut-task", text: file.basename });
      chip.createSpan({ cls: "pm-anchor-shortcut-label", text: file.path });
      chip.addEventListener("click", () => {
        this.selectedNotePath = file.path;
        this.render();
      });
    });
  }

  private renderMindmapControls(
    container: HTMLElement,
    projects: MindmapProjectOption[],
    nodeOptions: MindmapAnchorOption[],
    recentNodeOptions: MindmapAnchorOption[],
    selectedNode?: MindmapAnchorOption
  ): void {
    const project = projects.find((item) => item.id === this.selectedMindmapProjectId);
    const projectCard = this.renderPathCard(container, {
      icon: "folders",
      title: "目标项目",
      path: project?.label ?? "请选择项目",
      muted: project?.note ?? "先选择项目，再展开该项目下的任务节点和评语节点。"
    });
    const projectActions = projectCard.createDiv({ cls: "pm-path-actions" });
    const projectPicker = projectActions.createEl("button", { cls: "pm-button pm-button-secondary pm-path-button" });
    setIcon(projectPicker, "folder-tree");
    projectPicker.title = "选择项目";
    projectPicker.addEventListener("click", () => {
      new EntitySuggestModal<MindmapProjectOption>(this.app, {
        items: projects,
        placeholder: "先选择项目",
        emptyStateText: "暂无可补充导图的项目",
        getItemText: (item) => item.label,
        getItemNote: (item) => item.note,
        onChoose: (item) => {
          this.selectedMindmapProjectId = item.id;
          this.selectedTaskId = "";
          this.selectedCommentId = "";
          this.render();
        }
      }).open();
    });

    const nodeCard = this.renderPathCard(container, {
      icon: "workflow",
      title: "目标节点",
      path: selectedNode?.pathLabel ?? "请选择导图节点",
      muted: selectedNode?.note ?? "当前项目内的任务节点与评语节点都会在这里展示。"
    });
    const nodeActions = nodeCard.createDiv({ cls: "pm-path-actions" });
    const nodePicker = nodeActions.createEl("button", { cls: "pm-button pm-button-secondary pm-path-button" });
    nodePicker.disabled = nodeOptions.length === 0;
    setIcon(nodePicker, "list-tree");
    nodePicker.title = "选择节点";
    nodePicker.addEventListener("click", () => {
      new EntitySuggestModal<MindmapAnchorOption>(this.app, {
        items: nodeOptions,
        placeholder: "选择项目内的任务或评语节点",
        emptyStateText: "当前项目下暂无可用节点",
        getItemGroup: (item) => item.taskTitle,
        getItemText: (item) => item.label,
        getItemNote: (item) => item.note,
        onChoose: (item) => {
          this.selectMindmapNode(item);
          this.render();
        }
      }).open();
    });

    const modeTabs = container.createDiv({ cls: "pm-segmented-control" });
    [
      ["child", "创建子节点"],
      ["inside", "追加到节点正文"]
    ].forEach(([value, label]) => {
      const button = modeTabs.createEl("button", {
        text: label,
        cls: `pm-segmented-item ${this.mindmapInsertMode === value ? "is-active" : ""}`
      });
      button.addEventListener("click", () => {
        this.mindmapInsertMode = value as MindmapInsertMode;
        this.render();
      });
    });

    const shortcutCard = container.createDiv({ cls: "pm-input-card" });
    const shortcutHeader = shortcutCard.createDiv({ cls: "pm-input-card-header" });
    shortcutHeader.createEl("strong", { text: "快捷节点" });
    shortcutHeader.createDiv({ cls: "pm-muted", text: "跨任务共享，只保留最近使用的 6 个节点，并标注所属任务。" });
    const shortcuts = shortcutCard.createDiv({ cls: "pm-anchor-chip-list pm-anchor-shortcut-list" });
    if (recentNodeOptions.length === 0) {
      shortcuts.createDiv({ cls: "pm-muted", text: "还没有快捷节点，保存过一次导图补充后会出现在这里。" });
    } else {
      recentNodeOptions.forEach((option) => {
        const chip = shortcuts.createEl("button", {
          cls: `pm-anchor-chip pm-anchor-shortcut ${
            selectedNode?.taskId === option.taskId && selectedNode?.commentId === option.commentId ? "is-active" : ""
          }`
        });
        chip.title = `${option.taskTitle} · ${option.note}`;
        chip.createSpan({ cls: "pm-anchor-shortcut-task", text: option.taskTitle });
        chip.createSpan({ cls: "pm-anchor-shortcut-label", text: option.kind === "task" ? "任务节点" : option.pathLabel });
        chip.addEventListener("click", () => {
          this.selectedMindmapProjectId = option.projectId;
          this.selectMindmapNode(option);
          this.render();
        });
      });
    }
  }

  private renderPathCard(
    container: HTMLElement,
    options: { icon: string; title: string; path: string; muted: string }
  ): HTMLElement {
    const card = container.createDiv({ cls: "pm-path-card" });
    const icon = card.createDiv({ cls: "pm-path-icon" });
    setIcon(icon, options.icon);
    const body = card.createDiv({ cls: "pm-path-copy" });
    body.createDiv({ cls: "pm-path-label pm-muted", text: options.title });
    body.createDiv({ cls: "pm-path-value", text: options.path });
    body.createDiv({ cls: "pm-path-note pm-muted", text: options.muted });
    return card;
  }

  private renderQuickTaskPreview(container: HTMLElement, textarea: HTMLTextAreaElement): void {
    const previewCard = container.createDiv({ cls: "pm-input-card pm-dialog-task-preview" });
    const header = previewCard.createDiv({ cls: "pm-input-card-header" });
    header.createEl("strong", { text: "实时任务预览" });
    header.createDiv({ cls: "pm-muted", text: "支持数据迁移 JSON、今日完成极简 Markdown 和新任务计划复杂 Markdown。" });
    const body = previewCard.createDiv({ cls: "pm-dialog-task-preview-body" });

    const renderPreview = (): void => {
      body.empty();
      const preview = this.plugin.store.previewFormattedTasks(textarea.value, {
        defaultDate: toDateKey(now())
      });
      const summaryGrid = body.createDiv({ cls: "pm-import-summary-grid" });
      const summaryItems =
        preview.sourceFormat === "data-migration" && preview.dataMigration
          ? [
              ["记录类型", "数据迁移 JSON"],
              ["项目 / 任务", `${preview.dataMigration.projects} / ${preview.dataMigration.tasks}`],
              ["实例 / 导图关系", `${preview.dataMigration.occurrences} / ${preview.dataMigration.mindmapLinks}`],
              ["新增 / 覆盖", `${preview.summary.createCount} / ${preview.summary.overwriteCount}`]
            ]
          : [
              ["任务总数", String(preview.summary.total)],
              ["普通 / 组合", `${preview.tasks.filter((task) => task.input.kind !== "composite").length} / ${preview.summary.composite}`],
              ["单次 / 每日 / 每周", `${preview.tasks.filter((task) => task.input.recurrence === "once").length} / ${preview.tasks.filter((task) => task.input.recurrence === "daily").length} / ${preview.tasks.filter((task) => task.input.recurrence === "weekly").length}`],
              ["新增 / 覆盖", `${preview.summary.createCount} / ${preview.summary.overwriteCount}`]
            ];
      summaryItems.forEach(([label, value]) => {
        const card = summaryGrid.createDiv({ cls: "pm-import-summary-card" });
        card.createDiv({ cls: "pm-muted", text: label });
        card.createEl("strong", { text: value });
      });

      const rows = body.createDiv({ cls: "pm-dialog-task-preview-list" });
      if (preview.tasks.length === 0) {
        rows.createDiv({ cls: "pm-muted", text: "输入数据迁移 JSON、今日完成或任务计划后，这里会显示导入动作。" });
      } else {
        preview.tasks.slice(0, 8).forEach((task) => {
          const row = rows.createDiv({ cls: "pm-dialog-task-preview-item" });
          row.createEl("strong", { text: task.input.title });
          row.createDiv({
            cls: "pm-muted",
            text: [
              task.input.kind === "composite" ? "组合任务" : "普通任务",
              recurrenceText(task.input.recurrence),
              task.projectName ?? "未归属项目",
              task.input.date,
              task.input.startTime && task.input.endTime ? `${task.input.startTime}-${task.input.endTime}` : "未排期",
              importActionText(task.action)
            ].join(" · ")
          });
        });
      }

      if (preview.issues.length > 0) {
        const issueList = body.createEl("ul", { cls: "pm-import-issues" });
        preview.issues.slice(0, 6).forEach((issue) => {
          issueList.createEl("li", { text: `第 ${issue.line} 行：${issue.message}${issue.blocking ? "（阻止导入）" : ""}` });
        });
      }
    };

    renderPreview();
    textarea.addEventListener("input", renderPreview);
  }

  private ensureDialogSelections(tasks: Task[], allFiles: TFile[], recentFiles: TFile[], projects: MindmapProjectOption[]): void {
    if ((!this.selectedTaskId || !tasks.some((task) => task.id === this.selectedTaskId)) && tasks.length > 0) {
      this.selectedTaskId = tasks[0].id;
      this.selectedCommentId = "";
    }
    const noteFiles = recentFiles.length > 0 ? recentFiles : allFiles;
    if ((!this.selectedNotePath || !allFiles.some((file) => file.path === this.selectedNotePath)) && noteFiles.length > 0) {
      this.selectedNotePath = noteFiles[0].path;
    }
    if ((!this.selectedMindmapProjectId || !projects.some((project) => project.id === this.selectedMindmapProjectId)) && tasks.length > 0) {
      const selectedTask = tasks.find((task) => task.id === this.selectedTaskId);
      this.selectedMindmapProjectId = selectedTask ? mindmapProjectKey(selectedTask) : projects[0]?.id ?? "";
    }
  }

  private projectNameForTask(task: Task): string {
    return task.projectId ? this.plugin.store.getProject(task.projectId)?.name ?? "未归属项目" : "未归属项目";
  }

  private placeholderForTarget(): string {
    if (this.target === "quick-task") {
      return [
        "#项目：新的学习计划",
        "+ 任务：普通任务 @2026-05-18 09:00-10:00 #tag !high status:doing",
        "+ 组合：组合任务 @2026-05-18 14:00-15:00 #plan !medium status:todo",
        "  - 子任务一",
        "  - 子任务二",
        "+ 任务：每日复习 @2026-05-18 20:00-20:30 #review repeat:daily count:5",
        "+ 任务：每周回顾 @2026-05-18 21:00-21:30 #review status:todo repeat:weekly count:4"
      ].join("\n");
    }
    if (this.target === "mindmap") {
      return this.mindmapInsertMode === "inside"
        ? "输入后会追加到当前节点正文…"
        : "每一行会创建为一个评语子节点，例如：\n今天阅读效率不错\n语法题需要单独复盘";
    }
    if (this.target === "task-note") {
      return "在此输入或粘贴内容…";
    }
    return "在此输入或粘贴内容…";
  }

  private async submit(content: string, tasks: Task[]): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("内容不能为空");
    }
    if (this.target === "daily-note") {
      await this.appendDailyNote(trimmed);
      return;
    }
    if (this.target === "quick-task") {
      await this.plugin.store.importFormattedTasks(trimmed, {
        defaultDate: toDateKey(now()),
        source: {
          id: crypto.randomUUID(),
          type: "dialog",
          syncMode: "import-only",
          lastSyncedAt: new Date().toISOString()
        },
        historySummary: "从快速记录创建任务"
      });
      this.plugin.settings = this.plugin.store.getConfig();
      return;
    }
    if (this.target === "task-note") {
      await this.appendMarkdownNote(this.selectedNotePath, trimmed, this.plugin.settings.noteAppendHeader);
      return;
    }
    const selected = this.plugin.store.getTask(this.selectedTaskId) ?? tasks.find((task) => task.id === this.selectedTaskId);
    if (!selected) {
      throw new Error("请先选择导图节点");
    }
    if (this.mindmapInsertMode === "inside") {
      await this.appendToMindmapNode(selected, trimmed);
      this.recordRecentMindmapTarget(selected.id, this.selectedCommentId || null);
      return;
    }
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      await this.plugin.store.addTaskMindmapComment(selected.id, line.replace(/^-\s*/, ""), this.selectedCommentId || null);
    }
    this.recordRecentMindmapTarget(selected.id, this.selectedCommentId || null);
  }

  private ensureMindmapNodeSelection(options: MindmapAnchorOption[]): MindmapAnchorOption | undefined {
    const selected =
      options.find((option) => option.taskId === this.selectedTaskId && option.commentId === (this.selectedCommentId || null)) ?? options[0];
    if (!selected) {
      this.selectedTaskId = "";
      this.selectedCommentId = "";
      return undefined;
    }
    this.selectMindmapNode(selected);
    return selected;
  }

  private selectMindmapNode(option: MindmapAnchorOption): void {
    this.selectedTaskId = option.taskId;
    this.selectedCommentId = option.commentId ?? "";
  }

  private resolveRecentMindmapTargets(allNodeOptions: MindmapAnchorOption[]): MindmapAnchorOption[] {
    const lookup = new Map(allNodeOptions.map((option) => [`${option.taskId}::${option.commentId ?? ""}`, option]));
    QuickDialogView.recentMindmapTargets = QuickDialogView.recentMindmapTargets.filter((item) =>
      lookup.has(`${item.taskId}::${item.commentId ?? ""}`)
    );
    return QuickDialogView.recentMindmapTargets
      .map((item) => lookup.get(`${item.taskId}::${item.commentId ?? ""}`))
      .filter((item): item is MindmapAnchorOption => Boolean(item))
      .slice(0, 6);
  }

  private recordRecentMindmapTarget(taskId: string, commentId: string | null): void {
    const key = `${taskId}::${commentId ?? ""}`;
    QuickDialogView.recentMindmapTargets = [
      { taskId, commentId },
      ...QuickDialogView.recentMindmapTargets.filter((item) => `${item.taskId}::${item.commentId ?? ""}` !== key)
    ].slice(0, 6);
  }

  private async appendToMindmapNode(task: Task, content: string): Promise<void> {
    const latestTask = this.plugin.store.getTask(task.id);
    if (!latestTask) {
      throw new Error("目标任务不存在");
    }
    if (this.selectedCommentId) {
      const comment = latestTask.mindmapComments.find((item) => item.id === this.selectedCommentId);
      if (!comment) {
        throw new Error("评语节点不存在");
      }
      await this.plugin.store.updateTaskMindmapComment(latestTask.id, comment.id, {
        content: joinParagraphs(comment.content, content)
      });
      return;
    }
    await this.plugin.store.updateTask(latestTask.id, {
      description: joinParagraphs(latestTask.description ?? "", content)
    });
  }

  private resolveDailyNotePath(): string {
    const fileName = formatDateTimePattern(now(), this.plugin.settings.dailyNoteDateFormat || "YYYY-MM-DD");
    return this.plugin.settings.dailyNoteMode === "single-file"
      ? normalizePath(this.plugin.settings.dailyNoteSingleFilePath)
      : normalizePath(`${this.plugin.settings.dailyNoteFolder}/${fileName}.md`);
  }

  private async appendDailyNote(content: string): Promise<void> {
    await this.appendMarkdownNote(this.resolveDailyNotePath(), content, this.plugin.settings.dailyNoteHeader);
  }

  private async appendMarkdownNote(path: string, content: string, headerConfig: AppendHeaderConfig): Promise<void> {
    const filePath = normalizePath(path.trim());
    if (!filePath || filePath.endsWith("/")) {
      throw new Error("请选择有效的 Markdown 文件");
    }
    await this.ensureParentFolder(filePath);
    const existing = await this.app.vault.adapter.read(filePath).catch(() => "");
    const header = buildAppendHeader(headerConfig, now());
    const blocks = [existing.trimEnd(), header, content].filter((part) => part.trim().length > 0);
    const next = `${blocks.join("\n\n")}\n`;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      await this.app.vault.modify(file as TFile, next);
    } else {
      await this.app.vault.adapter.write(filePath, next);
    }
    await this.plugin.store.recordDialogWrite(filePath, `快速记录写入 ${filePath}`);
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop();
    const folder = normalizePath(parts.join("/"));
    if (folder) {
      await this.ensureFolder(folder);
    }
  }

  private getAllMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((left, right) => {
      const basenameCompare = left.basename.localeCompare(right.basename, "zh-Hans-CN");
      if (basenameCompare !== 0) {
        return basenameCompare;
      }
      return left.path.localeCompare(right.path, "zh-Hans-CN");
    });
  }

  private getRecentNoteFiles(allFiles: TFile[]): TFile[] {
    const byPath = new Map(allFiles.map((file) => [file.path, file]));
    const operated = this.plugin.store
      .getRecentDialogFilePaths(10)
      .map((path) => byPath.get(path))
      .filter((file): file is TFile => Boolean(file));
    if (operated.length >= 10) {
      return operated.slice(0, 10);
    }
    const used = new Set(operated.map((file) => file.path));
    const fallback = [...allFiles]
      .sort((left, right) => right.stat.mtime - left.stat.mtime)
      .filter((file) => !used.has(file.path))
      .slice(0, Math.max(0, 10 - operated.length));
    return [...operated, ...fallback];
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(cursor);
      if (folder instanceof TFolder) {
        continue;
      }
      const stat = await this.app.vault.adapter.stat(cursor);
      if (stat?.type === "folder") {
        continue;
      }
      await this.app.vault.createFolder(cursor);
    }
  }
}

type ToolbarAction = "bold" | "italic" | "heading" | "list" | "quote" | "code";
type QuickTaskShortcut = {
  label: string;
  hint: string;
  snippet: string;
};

function getTargetCards(): QuickTargetCard[] {
  return [
    { value: "daily-note", label: "写日记", desc: "保存到每日记录", icon: "book-marked" },
    { value: "task-note", label: "追加笔记", desc: "选择任意 Markdown 文件", icon: "file-pen-line" },
    { value: "quick-task", label: "创建任务", desc: "解析多行任务语法", icon: "list-plus" },
    { value: "mindmap", label: "补充导图", desc: "支持节点正文 / 子节点两种方式", icon: "git-branch-plus" }
  ];
}

function buildAppendHeader(config: AppendHeaderConfig, date: Date): string {
  if (!config.enabled) {
    return "";
  }
  const headingLevel = Math.min(6, Math.max(1, Math.floor(config.headingLevel || 2)));
  const dateText = formatDateTimePattern(date, config.dateFormat || "YYYY-MM-DD");
  const timeText = config.includeTime ? formatDateTimePattern(date, config.timeFormat || "HH:mm:ss") : "";
  const stamp = [dateText, timeText].filter(Boolean).join(config.separator ?? " ");
  const text = `${config.prefix ?? ""}${stamp}${config.suffix ?? ""}`.trim();
  return text ? `${"#".repeat(headingLevel)} ${text}` : "";
}

function sortTasksForMindmapSelection(tasks: Task[], getProjectName: (task: Task) => string): Task[] {
  return [...tasks].sort((left, right) => {
    const leftProject = getProjectName(left);
    const rightProject = getProjectName(right);
    const projectCompare = leftProject.localeCompare(rightProject, "zh-Hans-CN");
    if (projectCompare !== 0) {
      return projectCompare;
    }
    const titleCompare = left.title.localeCompare(right.title, "zh-Hans-CN");
    if (titleCompare !== 0) {
      return titleCompare;
    }
    return left.date.localeCompare(right.date);
  });
}

function buildMindmapProjectOptions(tasks: Task[], getProjectName: (task: Task) => string): MindmapProjectOption[] {
  const projects = new Map<string, MindmapProjectOption>();
  tasks.forEach((task) => {
    const key = mindmapProjectKey(task);
    if (projects.has(key)) {
      return;
    }
    projects.set(key, {
      id: key,
      label: getProjectName(task),
      note: key === UNASSIGNED_PROJECT_KEY ? "未归属项目任务会在这里集中展示。" : "选择后只展示该项目下的任务节点与评语节点。"
    });
  });
  return [...projects.values()].sort((left, right) => {
    if (left.id === UNASSIGNED_PROJECT_KEY) {
      return 1;
    }
    if (right.id === UNASSIGNED_PROJECT_KEY) {
      return -1;
    }
    return left.label.localeCompare(right.label, "zh-Hans-CN");
  });
}

function buildMindmapAnchorOptions(tasks: Task[]): MindmapAnchorOption[] {
  if (tasks.length === 0) {
    return [];
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskChildrenByParent = new Map<string | null, Task[]>();
  tasks.forEach((task) => {
    const parentId = task.viewState.mindmap.parentTaskId ?? null;
    const key = parentId && taskById.has(parentId) ? parentId : null;
    taskChildrenByParent.set(key, [...(taskChildrenByParent.get(key) ?? []), task]);
  });
  taskChildrenByParent.forEach((items) => items.sort((a, b) => a.viewState.mindmap.childOrder - b.viewState.mindmap.childOrder || compareTaskTitles(a, b)));

  const options: MindmapAnchorOption[] = [];
  const visitComments = (task: Task, parentCommentId: string | null, depth: number): void => {
    const comments = task.mindmapComments
      .filter((comment) => (comment.parentCommentId ?? null) === parentCommentId)
      .sort((left, right) => left.childOrder - right.childOrder);
    comments.forEach((comment) => {
      const prefix = depth > 0 ? "· ".repeat(depth) : "";
      options.push({
        taskId: task.id,
        commentId: comment.id,
        projectId: mindmapProjectKey(task),
        label: `${prefix}评语 · ${truncateText(comment.content, 20)}`,
        note: comment.content,
        taskTitle: task.title,
        pathLabel: `评语 · ${truncateText(comment.content, 24)}`,
        kind: "comment"
      });
      visitComments(task, comment.id, depth + 1);
    });
  };
  const visitTasks = (parentTaskId: string | null, depth: number): void => {
    (taskChildrenByParent.get(parentTaskId) ?? []).forEach((task) => {
      const prefix = depth > 0 ? "· ".repeat(depth) : "";
      options.push({
        taskId: task.id,
        commentId: null,
        projectId: mindmapProjectKey(task),
        label: `${prefix}${task.title}`,
        note: `${task.projectId ? "项目任务" : "未归属项目"} · ${task.date} · ${statusText(task.status)}`,
        taskTitle: task.title,
        pathLabel: task.title,
        kind: "task"
      });
      visitComments(task, null, depth + 1);
      visitTasks(task.id, depth + 1);
    });
  };
  visitTasks(null, 0);
  return options;
}

function editorHint(target: DialogTarget, mode: MindmapInsertMode): string {
  if (target === "mindmap") {
    return mode === "inside" ? "当前会把内容并入所选节点正文。" : "当前会把每一行解析成一个新的评语节点。";
  }
  if (target === "quick-task") {
    return "数据迁移 JSON 用于恢复数据；+ 任务 / + 组合用于计划；极简勾选只用于完成今日已有任务。";
  }
  return "编辑区已包裹成独立卡片，便于专注输入。";
}

function buildQuickTaskShortcuts(): QuickTaskShortcut[] {
  const today = toDateKey(now());
  return [
    {
      label: "普通任务",
      hint: "插入普通任务模板",
      snippet: `+ 任务：普通任务 @${today} 09:00-09:30 status:todo`
    },
    {
      label: "组合任务",
      hint: "插入组合任务模板和两个子任务",
      snippet: `+ 组合：组合任务 @${today} 10:00-11:00 status:todo\n  - 子任务一\n  - 子任务二`
    },
    {
      label: "单次",
      hint: "插入单次任务模板",
      snippet: `+ 任务：单次任务 @${today} 14:00-14:30 repeat:once status:todo`
    },
    {
      label: "每日",
      hint: "插入每日任务模板",
      snippet: `+ 任务：每日任务 @${today} 20:00-20:20 repeat:daily count:7 status:todo`
    },
    {
      label: "每周此时",
      hint: "插入每周重复模板",
      snippet: `+ 任务：每周任务 @${today} 21:00-21:30 repeat:weekly count:4 status:todo`
    },
    {
      label: "未归属项目",
      hint: "插入未归属项目分组",
      snippet: "#项目："
    }
  ];
}

function insertQuickTaskSnippet(textarea: HTMLTextAreaElement, snippet: string): void {
  const value = textarea.value.trimEnd();
  const next = value ? `${value}\n${snippet}` : snippet;
  textarea.value = next;
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
}

function applyEditorFormat(textarea: HTMLTextAreaElement, action: ToolbarAction): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  let next = selected;
  if (action === "bold") {
    next = `**${selected || "加粗"}**`;
  } else if (action === "italic") {
    next = `*${selected || "斜体"}*`;
  } else if (action === "heading") {
    next = `## ${selected || "标题"}`;
  } else if (action === "list") {
    next = prefixEachLine(selected || "列表项", "- ");
  } else if (action === "quote") {
    next = prefixEachLine(selected || "引用", "> ");
  } else if (action === "code") {
    next = selected.includes("\n") ? `\`\`\`\n${selected || "代码"}\n\`\`\`` : `\`${selected || "代码"}\``;
  }
  textarea.setRangeText(next, start, end, "end");
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
}

function prefixEachLine(value: string, prefix: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function joinParagraphs(current: string, addition: string): string {
  const trimmedCurrent = current.trim();
  const trimmedAddition = addition.trim();
  if (!trimmedCurrent) {
    return trimmedAddition;
  }
  return `${trimmedCurrent}\n${trimmedAddition}`;
}

const UNASSIGNED_PROJECT_KEY = "__pm-unassigned-project__";

function mindmapProjectKey(task: Task): string {
  return task.projectId ?? UNASSIGNED_PROJECT_KEY;
}

function compareTaskTitles(left: Task, right: Task): number {
  const titleCompare = left.title.localeCompare(right.title, "zh-Hans-CN");
  if (titleCompare !== 0) {
    return titleCompare;
  }
  return left.date.localeCompare(right.date);
}

function statusText(status: Task["status"]): string {
  if (status === "doing") {
    return "进行中";
  }
  if (status === "blocked") {
    return "阻塞";
  }
  if (status === "done") {
    return "已完成";
  }
  return "待办";
}

function recurrenceText(recurrence: Task["recurrence"]): string {
  if (recurrence === "daily") {
    return "每日";
  }
  if (recurrence === "weekly") {
    return "每周此时";
  }
  if (recurrence === "custom") {
    return "自定义";
  }
  return "单次";
}

function importActionText(action: "create" | "overwrite" | "complete-today" | "complete-series"): string {
  if (action === "complete-series") {
    return "完成并结束整个系列";
  }
  if (action === "complete-today") {
    return "完成当天";
  }
  if (action === "overwrite") {
    return "覆盖已有任务";
  }
  return "新增任务";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value;
}
