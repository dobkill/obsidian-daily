import { Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { TaskModal } from "../components/taskModal";
import type ProjectManagementPlugin from "../main";
import { Task, TaskOccurrence } from "../types";
import { copyTextToClipboard } from "../utils/clipboard";
import { now, parseTimeToMinutes, toDateKey } from "../utils/date";
import { BaseProjectView } from "./base";

export const TODAY_VIEW_TYPE = "project-management-today-view";

export class TodayTasksView extends BaseProjectView {
  constructor(leaf: WorkspaceLeaf, plugin: ProjectManagementPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return TODAY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "今日任务";
  }

  getIcon(): string {
    return "check-square";
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("pm-view", "pm-today-view");

    const today = toDateKey(now());
    const tasks = this.plugin.store.getTasksForDate(today);
    const displayTasks = buildCompositeDisplayOccurrences(tasks, this.plugin.store.getAllTasks());
    const projects = this.plugin.store.getProjects();
    const totalSteps = tasks.reduce((sum, task) => sum + task.totalSteps, 0);
    const completedSteps = tasks.reduce((sum, task) => sum + task.completedSteps, 0);
    const progress = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
    const rawIncomplete = tasks.filter((task) => !task.completed);

    const header = container.createDiv({ cls: "pm-page-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "今日任务" });
    title.createDiv({ text: today, cls: "pm-muted" });
    const actions = header.createDiv({ cls: "pm-inline-actions" });
    const exportButton = actions.createEl("button", { text: "导出今日任务", cls: "pm-button pm-button-secondary" });
    exportButton.addEventListener("click", async () => this.copyIncompleteTasks(rawIncomplete));
    const addButton = actions.createEl("button", { text: "+ 新增任务", cls: "pm-button pm-button-primary" });
    addButton.addEventListener("click", () => {
      const suggested = this.plugin.store.getSuggestedTaskWindow(today);
      new TaskModal(this.app, {
        title: "新增今日任务",
        projects,
        compositeParents: this.plugin.store.getCompositeTasks(),
        initial: {
          title: "",
          description: "",
          date: today,
          status: "todo",
          tags: [],
          recurrence: "once",
          completed: false,
          ...suggested
        },
        onSubmit: async (input) => {
          await this.plugin.store.createTask(input);
        }
      }).open();
    });

    const progressCard = container.createDiv({ cls: "pm-today-progress-card" });
    const progressLeft = progressCard.createDiv({ cls: "pm-today-progress-ring-wrap" });
    renderProgressRing(progressLeft, progress);
    const progressBody = progressCard.createDiv({ cls: "pm-today-progress-copy" });
    progressBody.createDiv({ cls: "pm-muted", text: "今日进度" });
    progressBody.createEl("strong", { text: `${completedSteps} / ${totalSteps} 步` });
    progressBody.createDiv({ cls: "pm-muted", text: tasks.length === 0 ? "今天还没有任务，先新增一条开始吧。" : `${tasks.length} 个任务，完成率 ${progress}%` });
    const progressBar = progressBody.createDiv({ cls: "pm-progress-bar" });
    progressBar.createDiv({
      cls: "pm-progress-bar-fill",
      attr: { style: `width: ${progress}%` }
    });

    const incomplete = displayTasks.filter((item) => !summarizeOccurrenceDisplay(item.occurrence, item.childOccurrences).completed);
    const complete = displayTasks.filter((item) => summarizeOccurrenceDisplay(item.occurrence, item.childOccurrences).completed);

    this.renderTaskSection(container, "未完成", incomplete, {
      emptyTitle: "今天暂时没有未完成任务",
      emptyBody: "已经清空待办时，这里会保持专注而安静。"
    });
    this.renderTaskSection(container, "已完成", complete, {
      emptyTitle: "完成任务后会显示在这里",
      emptyBody: "完成的任务会自动汇总到这一栏，方便你快速回顾。"
    });

    const tipCard = container.createDiv({ cls: "pm-tip-card" });
    const icon = tipCard.createDiv({ cls: "pm-tip-icon" });
    setIcon(icon, "sparkles");
    const copy = tipCard.createDiv();
    copy.createEl("strong", { text: "小贴士" });
    copy.createDiv({ cls: "pm-muted", text: "导出按钮会复制极简今日清单；把某一行改成已完成后粘回快速记录，会只完成今天已有任务。" });
  }

  private async copyIncompleteTasks(tasks: TaskOccurrence[]): Promise<void> {
    if (tasks.length === 0) {
      new Notice("今天没有未完成任务可导出");
      return;
    }
    const text = this.plugin.store.exportTasksAsMinimalCompletionText(tasks);
    await copyTextToClipboard(text);
    new Notice("已复制今日未完成任务");
  }

  private renderTaskSection(
    container: HTMLElement,
    title: string,
    tasks: CompositeDisplayOccurrence[],
    emptyState: { emptyTitle: string; emptyBody: string }
  ): void {
    const section = container.createDiv({ cls: "pm-section pm-task-section" });
    const header = section.createDiv({ cls: "pm-section-header" });
    header.createEl("h3", { text: `${title} (${tasks.length})` });

    if (tasks.length === 0) {
      const empty = section.createDiv({ cls: "pm-empty-state-card" });
      const icon = empty.createDiv({ cls: "pm-empty-state-icon" });
      setIcon(icon, "badge-check");
      empty.createEl("strong", { text: emptyState.emptyTitle });
      empty.createDiv({ cls: "pm-muted", text: emptyState.emptyBody });
      return;
    }

    const list = section.createDiv({ cls: "pm-task-list" });
    tasks.forEach((item) => {
      const task = item.occurrence;
      const displayProgress = summarizeOccurrenceDisplay(task, item.childOccurrences);
      const row = list.createDiv({ cls: `pm-task-card ${displayProgress.completed ? "is-complete" : ""}` });
      const main = row.createDiv({ cls: "pm-task-card-main" });

      if (task.kind === "simple") {
        const checkbox = main.createEl("input", { type: "checkbox", cls: "pm-task-checkbox" });
        checkbox.checked = task.completed;
        checkbox.addEventListener("change", async () => {
          try {
            await this.plugin.store.updateTaskOccurrenceCompletion(task.taskId, task.date, checkbox.checked);
          } catch (error) {
            checkbox.checked = !checkbox.checked;
            new Notice(error instanceof Error ? error.message : "更新失败");
          }
        });
      }

      const copy = main.createDiv({ cls: "pm-task-copy" });
      copy.createEl("div", { text: task.title, cls: `pm-task-title ${displayProgress.completed ? "is-complete" : ""}` });
      const meta = copy.createDiv({ cls: "pm-task-meta" });
      appendBadge(meta, task.startTime && task.endTime ? `${task.startTime}-${task.endTime}` : "未排期", "muted");
      appendBadge(meta, recurrenceLabel(task), "repeat");
      appendBadge(meta, statusLabel(task.status), `status-${task.status}`);
      appendBadge(meta, this.plugin.store.getProject(task.projectId)?.name ?? "未归属项目", "tag");
      if (task.kind === "composite") {
        appendBadge(meta, `${displayProgress.completedSteps}/${displayProgress.totalSteps} 子项`, "priority-medium");
        this.renderSubtasks(copy, task, item.childOccurrences);
      }

      const actions = row.createDiv({ cls: "pm-task-card-actions" });
      const moreButton = actions.createEl("button", { cls: "pm-icon-button", attr: { "aria-label": "更多操作" } });
      setIcon(moreButton, "ellipsis");
      moreButton.addEventListener("click", (event) => this.openTaskMenu(event, task));
    });
  }

  private openTaskMenu(event: MouseEvent, task: TaskOccurrence): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("编辑任务").setIcon("square-pen").onClick(() => {
        if (isSyntheticCompositeOccurrence(task)) {
          const seriesTask = this.plugin.store.getTask(task.taskId);
          if (seriesTask) {
            this.openSeriesEditor(seriesTask);
          }
          return;
        }
        this.openEditor(task);
      })
    );
    if (isSyntheticCompositeOccurrence(task)) {
      menu.showAtMouseEvent(event);
      return;
    }
    if (task.recurrence !== "once") {
      menu.addItem((item) =>
        item.setTitle("提前结束系列").setIcon("calendar-x").onClick(async () => {
          await this.plugin.store.completeTaskSeries(task.taskId, task.date);
        })
      );
    }
    menu.addItem((item) =>
      item.setTitle("删除").setIcon("trash-2").onClick(async () => {
        await this.plugin.store.deleteTaskOccurrence(task.taskId, task.date);
      })
    );
    menu.showAtMouseEvent(event);
  }

  private openEditor(task: TaskOccurrence): void {
    const seriesTask = this.plugin.store.getTask(task.taskId);
    if (!seriesTask) {
      return;
    }
    this.openOccurrenceEditor(seriesTask, task);
  }

  private openSeriesEditor(seriesTask: Task): void {
    new TaskModal(this.app, {
      title: "编辑任务",
      projects: this.plugin.store.getProjects(),
      compositeParents: this.plugin.store.getCompositeTasks(),
      existingTask: seriesTask,
      initial: {
        title: seriesTask.title,
        description: seriesTask.description,
        projectId: seriesTask.projectId,
        status: seriesTask.status,
        priority: seriesTask.priority,
        tags: seriesTask.tags,
        date: seriesTask.date,
        startTime: seriesTask.startTime,
        endTime: seriesTask.endTime,
        recurrence: seriesTask.recurrence,
        recurrenceCount: seriesTask.recurrenceCount ?? null,
        recurrenceUntil: seriesTask.recurrenceUntil ?? null,
        kind: seriesTask.kind,
        subtasks: seriesTask.subtasks,
        viewState: seriesTask.viewState,
        completed: isTaskSeriesCompleted(seriesTask)
      },
      onSubmit: async (input) => {
        await this.plugin.store.updateTask(seriesTask.id, input, "series");
      },
      onDelete: async (scope) => {
        await this.plugin.store.deleteTask(seriesTask.id, "series");
      },
      onCompleteSeries: async () => {
        await this.plugin.store.completeTaskSeries(seriesTask.id);
      },
      allowSingleDelete: false
    }).open();
  }

  private openOccurrenceEditor(seriesTask: Task, task: TaskOccurrence): void {
    new TaskModal(this.app, {
      title: "编辑任务",
      projects: this.plugin.store.getProjects(),
      compositeParents: this.plugin.store.getCompositeTasks(),
      existingTask: seriesTask,
      occurrenceContext: task,
      initial: {
        title: task.title,
        description: task.description,
        projectId: seriesTask.projectId,
        status: seriesTask.status,
        priority: seriesTask.priority,
        tags: seriesTask.tags,
        date: task.date,
        startTime: task.startTime,
        endTime: task.endTime,
        recurrence: seriesTask.recurrence,
        recurrenceCount: seriesTask.recurrenceCount ?? null,
        recurrenceUntil: seriesTask.recurrenceUntil ?? null,
        kind: seriesTask.kind,
        subtasks: seriesTask.subtasks,
        viewState: seriesTask.viewState,
        completed: task.completed
      },
      onSubmit: async (input, scope) => {
        if (scope === "occurrence") {
          await this.plugin.store.updateTaskOccurrenceDetails(seriesTask.id, task.date, {
            title: input.title,
            description: input.description,
            startTime: input.startTime,
            endTime: input.endTime
          });
          return;
        }
        await this.plugin.store.updateTask(seriesTask.id, input, "series");
      },
      onDelete: async (scope) => {
        if (scope === "single") {
          await this.plugin.store.deleteTaskOccurrence(seriesTask.id, task.date);
          return;
        }
        await this.plugin.store.deleteTask(seriesTask.id, "series");
      },
      onCompleteSeries: async () => {
        await this.plugin.store.completeTaskSeries(seriesTask.id, task.date);
      },
      onOpenSeriesEditor: () => {
        this.openSeriesEditor(seriesTask);
      },
      allowSingleDelete: true
    }).open();
  }

  private renderSubtasks(container: HTMLElement, task: TaskOccurrence, childOccurrences: TaskOccurrence[] = []): void {
    if (task.kind !== "composite") {
      return;
    }
    const grid = container.createDiv({ cls: "pm-subtask-grid" });
    task.subtasks.forEach((subtask) => {
      const item = grid.createEl("button", {
        text: formatSubtaskLabel(subtask),
        cls: `pm-subtask-chip ${task.completedSubtaskIds.includes(subtask.id) ? "is-complete" : ""}`
      });
      item.addEventListener("click", async () => {
        const completed = !task.completedSubtaskIds.includes(subtask.id);
        try {
          await this.plugin.store.updateTaskOccurrenceSubtaskCompletion(task.taskId, task.date, subtask.id, completed);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "更新失败");
        }
      });
    });
    childOccurrences.forEach((child) => {
      const item = grid.createDiv({
        cls: `pm-subtask-chip pm-subtask-task ${child.completed ? "is-complete" : ""}`
      });
      item.addEventListener("click", async () => {
        try {
          await this.plugin.store.updateTaskOccurrenceCompletion(child.taskId, child.date, !child.completed);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "更新失败");
        }
      });
      item.createDiv({ cls: "pm-subtask-title", text: child.title });
      item.createDiv({
        cls: "pm-subtask-meta",
        text: `${recurrenceLabel(child)}${child.startTime && child.endTime ? ` · ${child.startTime}-${child.endTime}` : ""}`
      });
      const actions = item.createDiv({ cls: "pm-subtask-actions" });
      const edit = actions.createEl("button", { text: "编辑", cls: "pm-subtask-action" });
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openEditor(child);
      });
      const remove = actions.createEl("button", { text: "删除", cls: "pm-subtask-action mod-warning" });
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.store.deleteTask(child.taskId, "series");
      });
    });
  }
}

type CompositeDisplayOccurrence = {
  occurrence: TaskOccurrence;
  childOccurrences: TaskOccurrence[];
};

function buildCompositeDisplayOccurrences(occurrences: TaskOccurrence[], seriesTasks: Task[]): CompositeDisplayOccurrence[] {
  const taskById = new Map(seriesTasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, TaskOccurrence[]>();
  const hiddenOccurrenceIds = new Set<string>();

  occurrences.forEach((occurrence) => {
    const parentId = getCompositeParentId(occurrence.taskId, taskById);
    if (!parentId) {
      return;
    }
    hiddenOccurrenceIds.add(occurrence.id);
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), occurrence]);
  });
  childrenByParent.forEach((children, parentId) => childrenByParent.set(parentId, children.slice().sort(compareTaskOccurrences)));

  const display = occurrences
    .filter((occurrence) => !hiddenOccurrenceIds.has(occurrence.id))
    .map<CompositeDisplayOccurrence>((occurrence) => ({
      occurrence,
      childOccurrences: childrenByParent.get(occurrence.taskId) ?? []
    }));

  const displayedTaskIds = new Set(display.map((item) => item.occurrence.taskId));
  childrenByParent.forEach((children, parentId) => {
    if (displayedTaskIds.has(parentId)) {
      return;
    }
    const parent = taskById.get(parentId);
    if (!parent) {
      return;
    }
    display.push({
      occurrence: buildCompositeContainerOccurrence(parent, children[0].date, children),
      childOccurrences: children
    });
  });

  return display.sort((left, right) => compareTaskOccurrences(left.occurrence, right.occurrence));
}

function getCompositeParentId(taskId: string, taskById: Map<string, Task>): string | null {
  const parentId = taskById.get(taskId)?.viewState.mindmap.parentTaskId ?? null;
  if (!parentId) {
    return null;
  }
  const parent = taskById.get(parentId);
  return parent?.kind === "composite" ? parent.id : null;
}

function buildCompositeContainerOccurrence(parent: Task, date: string, childOccurrences: TaskOccurrence[]): TaskOccurrence {
  const progress = summarizeChildOccurrences(childOccurrences);
  const window = summarizeChildWindow(childOccurrences);
  return {
    id: `${parent.id}::${date}::children`,
    taskId: parent.id,
    parentTaskId: parent.viewState.mindmap.parentTaskId ?? null,
    occurrenceDate: date,
    occurrenceNumber: parent.occurrenceDates.findIndex((entry) => entry === date) + 1 || 1,
    kind: parent.kind,
    title: parent.title,
    description: parent.description,
    projectId: parent.projectId,
    status: parent.status,
    priority: parent.priority,
    tags: [...parent.tags],
    date,
    startTime: window.startTime ?? parent.startTime,
    endTime: window.endTime ?? parent.endTime,
    recurrence: parent.recurrence,
    recurrenceCount: parent.recurrenceCount ?? null,
    recurrenceUntil: parent.recurrenceUntil ?? null,
    subtasks: parent.subtasks.map((subtask) => ({ ...subtask })),
    sourceLinks: parent.sourceLinks.map((source) => ({ ...source })),
    notes: parent.notes.map((note) => ({ ...note })),
    completedSubtaskIds: [],
    progress: progress.totalSteps === 0 ? 0 : progress.completedSteps / progress.totalSteps,
    totalSteps: progress.totalSteps,
    completedSteps: progress.completedSteps,
    completed: progress.completed,
    completedAt: progress.completed ? childOccurrences.map((child) => child.completedAt).filter(Boolean).sort().reverse()[0] ?? null : null,
    createdAt: parent.createdAt,
    updatedAt: parent.updatedAt,
    revision: parent.revision
  };
}

function isSyntheticCompositeOccurrence(occurrence: TaskOccurrence): boolean {
  return occurrence.id.endsWith("::children");
}

function summarizeOccurrenceDisplay(
  occurrence: TaskOccurrence,
  childOccurrences: TaskOccurrence[]
): { totalSteps: number; completedSteps: number; completed: boolean } {
  const childProgress = summarizeChildOccurrences(childOccurrences);
  const totalSteps = occurrence.totalSteps + childProgress.totalSteps;
  const completedSteps = occurrence.completedSteps + childProgress.completedSteps;
  return {
    totalSteps,
    completedSteps,
    completed: totalSteps > 0 ? completedSteps === totalSteps : occurrence.completed
  };
}

function summarizeChildOccurrences(childOccurrences: TaskOccurrence[]): { totalSteps: number; completedSteps: number; completed: boolean } {
  const totalSteps = childOccurrences.reduce((sum, child) => sum + child.totalSteps, 0);
  const completedSteps = childOccurrences.reduce((sum, child) => sum + child.completedSteps, 0);
  return {
    totalSteps,
    completedSteps,
    completed: childOccurrences.length > 0 && totalSteps > 0 && completedSteps === totalSteps
  };
}

function summarizeChildWindow(childOccurrences: TaskOccurrence[]): { startTime?: string; endTime?: string } {
  const timed = childOccurrences
    .map((child) => ({
      start: parseTimeToMinutes(child.startTime),
      end: parseTimeToMinutes(child.endTime),
      startTime: child.startTime,
      endTime: child.endTime
    }))
    .filter((item): item is { start: number; end: number; startTime: string; endTime: string } => item.start !== null && item.end !== null && Boolean(item.startTime && item.endTime));
  if (timed.length === 0) {
    return {};
  }
  const first = timed.reduce((best, item) => (item.start < best.start ? item : best), timed[0]);
  const last = timed.reduce((best, item) => (item.end > best.end ? item : best), timed[0]);
  return { startTime: first.startTime, endTime: last.endTime };
}

function compareTaskOccurrences(a: TaskOccurrence, b: TaskOccurrence): number {
  const startA = parseTimeToMinutes(a.startTime);
  const startB = parseTimeToMinutes(b.startTime);
  if (startA === null && startB === null) {
    return a.title.localeCompare(b.title);
  }
  if (startA === null) {
    return 1;
  }
  if (startB === null) {
    return -1;
  }
  return startA - startB || a.title.localeCompare(b.title);
}

function renderProgressRing(container: HTMLElement, progress: number): void {
  const ring = container.createDiv({ cls: "pm-progress-ring" });
  ring.style.setProperty("--pm-progress", String(progress));
  ring.createDiv({ cls: "pm-progress-ring-inner", text: `${progress}%` });
}

function appendBadge(container: HTMLElement, label: string, tone: string): void {
  container.createSpan({ text: label, cls: `pm-badge pm-badge-${tone}` });
}

function recurrenceLabel(task: TaskOccurrence): string {
  if (task.recurrence === "daily") {
    return "每日重复";
  }
  if (task.recurrence === "weekly") {
    return "每周此时重复";
  }
  if (task.recurrence === "custom") {
    return "自定义重复";
  }
  return "单次任务";
}

function statusLabel(status: TaskOccurrence["status"]): string {
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

function formatSubtaskLabel(subtask: { title: string; startTime?: string; endTime?: string }): string {
  return subtask.startTime && subtask.endTime ? `${subtask.title} · ${subtask.startTime}-${subtask.endTime}` : subtask.title;
}

function isTaskSeriesCompleted(task: Task): boolean {
  if (task.occurrenceDates.length === 0) {
    return false;
  }
  return task.occurrenceDates.every((date) => {
    const state = task.occurrenceStates.find((item) => item.date === date);
    if (task.kind === "simple") {
      return Boolean(state);
    }
    if (task.subtasks.length === 0) {
      return Boolean(state?.completedAt);
    }
    const completedIds = new Set(state?.completedSubtaskIds ?? []);
    return task.subtasks.every((subtask) => completedIds.has(subtask.id));
  });
}
