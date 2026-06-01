import { setIcon } from "obsidian";
import { Task, TaskOccurrence, TaskRecurrence, TaskStatus } from "../types";

type MaybePromise = void | Promise<void>;

type CompositeOccurrenceCardsOptions = {
  parentOccurrence: TaskOccurrence;
  childOccurrences: TaskOccurrence[];
  onToggleChildOccurrence: (child: TaskOccurrence) => MaybePromise;
  onEditChildOccurrence: (child: TaskOccurrence) => MaybePromise;
  onDeleteChildTask: (child: TaskOccurrence) => MaybePromise;
  compact?: boolean;
};

type AttachedCompositeTaskCardsOptions = {
  tasks: Task[];
  onEditTask?: (task: Task) => MaybePromise;
};

export function renderCompositeOccurrenceCards(container: HTMLElement, options: CompositeOccurrenceCardsOptions): void {
  if (options.childOccurrences.length === 0) {
    return;
  }
  const grid = container.createDiv({ cls: `pm-subtask-grid pm-subtask-card-grid ${options.compact ? "is-compact" : ""}` });

  options.childOccurrences.forEach((child) => {
    const card = grid.createDiv({
      cls: `pm-subtask-card pm-subtask-task is-interactive ${options.compact ? "is-compact" : ""} ${child.completed ? "is-complete" : ""}`
    });
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = child.title;
    bindActivation(card, () => options.onToggleChildOccurrence(child));
    renderSubtaskCardBody(card, child.title, options.compact ? [] : [formatTaskRecurrenceLabel(child.recurrence), formatOptionalTimeRange(child)]);

    if (options.compact) {
      return;
    }
    const actions = card.createDiv({ cls: "pm-subtask-actions" });
    appendIconAction(actions, "square-pen", "编辑", "", () => options.onEditChildOccurrence(child));
    appendIconAction(actions, "trash-2", "删除", "mod-warning", () => options.onDeleteChildTask(child));
  });
}

export function renderAttachedCompositeTaskCards(container: HTMLElement, options: AttachedCompositeTaskCardsOptions): void {
  options.tasks.forEach((task) => {
    const card = container.createDiv({ cls: `pm-subtask-card pm-subtask-task is-${task.status}` });
    renderSubtaskCardBody(card, task.title, [formatTaskRecurrenceLabel(task.recurrence), formatTaskStatusLabel(task.status), formatOptionalTimeRange(task)]);
    if (!options.onEditTask) {
      return;
    }
    const actions = card.createDiv({ cls: "pm-subtask-actions" });
    appendIconAction(actions, "square-pen", "编辑", "", () => options.onEditTask?.(task));
  });
}

export function formatOptionalTimeRange(item: Pick<Task | TaskOccurrence, "startTime" | "endTime">): string {
  return item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : "";
}

export function formatTaskRecurrenceLabel(recurrence: TaskRecurrence): string {
  if (recurrence === "daily") {
    return "每日重复";
  }
  if (recurrence === "weekly") {
    return "每周此时重复";
  }
  if (recurrence === "custom") {
    return "自定义重复";
  }
  return "单次任务";
}

export function formatTaskStatusLabel(status: TaskStatus): string {
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

function renderSubtaskCardBody(container: HTMLElement, title: string, metaParts: string[]): void {
  container.createDiv({ cls: "pm-subtask-title", text: title });
  const meta = metaParts.map((part) => part.trim()).filter(Boolean).join(" · ");
  if (meta) {
    container.createDiv({ cls: "pm-subtask-meta", text: meta });
  }
}

function bindActivation(element: HTMLElement, handler: () => MaybePromise): void {
  element.addEventListener("click", () => {
    void handler();
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    void handler();
  });
}

function appendIconAction(container: HTMLElement, icon: string, label: string, extraClass: string, handler: () => MaybePromise): void {
  const button = container.createEl("button", {
    cls: `pm-subtask-action pm-subtask-icon-action ${extraClass}`.trim(),
    attr: {
      type: "button",
      "aria-label": label,
      title: label
    }
  });
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handler();
  });
}
