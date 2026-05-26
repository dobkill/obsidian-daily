import { Task, TaskOccurrence } from "../types";
import { parseTimeToMinutes } from "../utils/date";

export type CompositeDisplayOccurrence = {
  occurrence: TaskOccurrence;
  childOccurrences: TaskOccurrence[];
};

export function buildCompositeDisplayOccurrences(occurrences: TaskOccurrence[], seriesTasks: Task[]): CompositeDisplayOccurrence[] {
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
  childrenByParent.forEach((children, parentId) => childrenByParent.set(parentId, children.slice().sort(compareDisplayOccurrences)));

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

  return display.sort((left, right) => compareDisplayOccurrences(left.occurrence, right.occurrence));
}

export function summarizeOccurrenceDisplay(
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

export function isSyntheticCompositeOccurrence(occurrence: TaskOccurrence): boolean {
  return occurrence.id.endsWith("::children");
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
  const childProgress = summarizeChildOccurrences(childOccurrences);
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
    subtasks: [],
    sourceLinks: parent.sourceLinks.map((source) => ({ ...source })),
    notes: parent.notes.map((note) => ({ ...note })),
    completedSubtaskIds: [],
    progress: 0,
    totalSteps: 0,
    completedSteps: 0,
    completed: childProgress.completed,
    completedAt: childProgress.completed ? childOccurrences.map((child) => child.completedAt).filter(Boolean).sort().reverse()[0] ?? null : null,
    createdAt: parent.createdAt,
    updatedAt: parent.updatedAt,
    revision: parent.revision
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

function compareDisplayOccurrences(a: TaskOccurrence, b: TaskOccurrence): number {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  const startA = parseTimeToMinutes(a.startTime);
  const startB = parseTimeToMinutes(b.startTime);
  if (startA === null && startB === null) {
    return a.occurrenceNumber - b.occurrenceNumber || a.title.localeCompare(b.title);
  }
  if (startA === null) {
    return 1;
  }
  if (startB === null) {
    return -1;
  }
  return startA - startB || a.title.localeCompare(b.title);
}
