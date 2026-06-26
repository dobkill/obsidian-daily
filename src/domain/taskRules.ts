import { Task, TaskKind, TaskOccurrence, TaskRecurrence, TaskStatus } from "../types";
import { addDays, parseDateKey, toDateKey } from "../utils/date";

export const SINGLE_TASK_RECURRENCE_COUNT = 1;
export const PERMANENT_RECURRENCE_COUNT = 2_147_483_647;
export const MAX_GENERATED_OCCURRENCES = 366;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  blocked: "阻塞",
  done: "已完成"
};

export const TASK_RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  daily: "每日此时重复",
  weekly: "每周此时重复",
  monthly: "每月此时重复"
};

export function recurrenceLabel(recurrence: TaskRecurrence): string {
  return TASK_RECURRENCE_LABELS[recurrence] ?? TASK_RECURRENCE_LABELS.daily;
}

export function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status] ?? TASK_STATUS_LABELS.todo;
}

export function isCompositeKind(kind: TaskKind): boolean {
  return kind === "composite";
}

export function isCompositeTask(task: Pick<Task | TaskOccurrence, "kind">): boolean {
  return task.kind === "composite";
}

export function isExecutableTask(task: Pick<Task | TaskOccurrence, "kind">): boolean {
  return task.kind === "simple";
}

export function isAttentionStatus(status: TaskStatus): boolean {
  return status === "todo" || status === "blocked";
}

export function isActionableStatus(status: TaskStatus): boolean {
  return status === "doing";
}

export function isActionableOccurrence(task: Pick<TaskOccurrence, "kind" | "status" | "completed">): boolean {
  return isExecutableTask(task) && isActionableStatus(task.status) && !task.completed;
}

export function isAttentionOccurrence(task: Pick<TaskOccurrence, "kind" | "status" | "completed">): boolean {
  return isExecutableTask(task) && isAttentionStatus(task.status) && !task.completed;
}

export function shouldConsumeOccurrence(
  task: Pick<TaskOccurrence, "status" | "completed" | "consumeRequiresCompletion">
): boolean {
  if (task.completed) {
    return true;
  }
  if (task.consumeRequiresCompletion) {
    return false;
  }
  return !isAttentionStatus(task.status);
}

export function normalizeTaskRecurrence(value?: string): TaskRecurrence {
  if (value === "weekly" || value === "monthly") {
    return value;
  }
  return "daily";
}

export function advanceRecurrenceDate(date: Date, recurrence: TaskRecurrence, anchorDay: number): Date {
  if (recurrence === "weekly") {
    return addDays(date, 7);
  }
  if (recurrence === "monthly") {
    return addMonthsKeepingAnchorDay(date, 1, anchorDay);
  }
  return addDays(date, 1);
}

export function addMonthsKeepingAnchorDay(date: Date, months: number, anchorDay: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchorDay, lastDay));
  return target;
}

export function detectRecurrenceFromDates(dates: string[]): TaskRecurrence {
  if (dates.length <= 1) {
    return "daily";
  }
  const first = parseDateKey(dates[0]);
  const second = parseDateKey(dates[1]);
  const diffDays = Math.round((second.getTime() - first.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 7) {
    return "weekly";
  }
  if (isNextMonthlyDate(dates[0], dates[1])) {
    return "monthly";
  }
  return "daily";
}

function isNextMonthlyDate(left: string, right: string): boolean {
  const leftDate = parseDateKey(left);
  const expected = addMonthsKeepingAnchorDay(leftDate, 1, leftDate.getDate());
  return toDateKey(expected) === right;
}
