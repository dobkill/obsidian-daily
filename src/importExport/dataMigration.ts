import {
  ProgressPage,
  Project,
  Task,
  TaskImportIssue,
  TaskInput,
  TaskKind,
  TaskMindmapComment,
  TaskNote,
  TaskOccurrenceOverride,
  TaskOccurrenceState,
  TaskPriority,
  TaskRecurrence,
  TaskSourceLink,
  TaskStatus,
  TaskSubtask,
  TaskViewState
} from "../types";
import { addDays, compareDateKeys, parseDateKey, toDateKey } from "../utils/date";

export const DATA_MIGRATION_SCHEMA = "obsidian-project-management/data-migration";
export const DATA_MIGRATION_VERSION = 2;
export const DATA_MIGRATION_FENCE = "pm-data-migration-json";

export type DataMigrationDateRange = {
  from: string;
  to: string;
  every: "day" | "week";
};

export type DataMigrationDateSet = {
  dates?: string[];
  ranges?: DataMigrationDateRange[];
};

export type DataMigrationOccurrencePlan =
  | {
      source: "dates";
      dates?: string[];
      ranges?: DataMigrationDateRange[];
    }
  | {
      source: "recurrence";
      exclude?: DataMigrationDateSet;
      include?: DataMigrationDateSet;
    };

export type DataMigrationTaskRecord = {
  id: string;
  kind?: TaskKind;
  title: string;
  description?: string;
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  recurrence?: TaskRecurrence;
  recurrenceCount?: number | null;
  recurrenceUntil?: string | null;
  occurrencePlan?: DataMigrationOccurrencePlan;
  subtasks?: TaskSubtask[];
  occurrenceStates?: TaskOccurrenceState[];
  occurrenceOverrides?: TaskOccurrenceOverride[];
  viewState?: Partial<TaskViewState>;
  sourceLinks?: TaskSourceLink[];
  notes?: TaskNote[];
  mindmapComments?: TaskMindmapComment[];
  createdAt: string;
  updatedAt: string;
  revision?: number;
};

export type DataMigrationPackage = {
  schema: typeof DATA_MIGRATION_SCHEMA;
  version: number;
  exportedAt: string;
  projects: Project[];
  progressPages: ProgressPage[];
  tasks: DataMigrationTaskRecord[];
};

export type DataMigrationSummary = {
  version: number;
  exportedAt?: string;
  projects: number;
  progressPages: number;
  tasks: number;
  occurrences: number;
  compositeTasks: number;
  mindmapLinks: number;
  ganttDependencies: number;
  mindmapComments: number;
  taskNotes: number;
  sourceLinks: number;
  occurrenceStates: number;
  occurrenceOverrides: number;
};

export type DataMigrationProjectPlan = {
  projectIdBySourceId: Map<string, string>;
  projects: Project[];
  newProjectNames: string[];
};

export type DataMigrationTaskPlan = {
  taskIdBySourceId: Map<string, string>;
  tasks: Task[];
  replacedTaskIds: string[];
  createCount: number;
  overwriteCount: number;
};

export type DataMigrationParseResult =
  | { kind: "none" }
  | { kind: "package"; package: DataMigrationPackage }
  | { kind: "invalid"; issues: TaskImportIssue[] };

export function buildDataMigrationJson(input: {
  projects: Project[];
  progressPages: ProgressPage[];
  tasks: Task[];
  exportedAt: string;
}): string {
  const payload: DataMigrationPackage = {
    schema: DATA_MIGRATION_SCHEMA,
    version: DATA_MIGRATION_VERSION,
    exportedAt: input.exportedAt,
    projects: input.projects,
    progressPages: input.progressPages,
    tasks: input.tasks.map(taskToDataMigrationRecord)
  };

  return JSON.stringify(payload, null, 2);
}

export function parseDataMigrationText(text: string): DataMigrationParseResult {
  const match = findDataMigrationJson(text);
  if (!match) {
    if (text.includes(DATA_MIGRATION_SCHEMA) || text.includes(DATA_MIGRATION_FENCE)) {
      return {
        kind: "invalid",
        issues: [{ line: 1, raw: firstNonEmptyLine(text), message: "数据迁移 JSON 格式不完整或代码块标记错误", blocking: true }]
      };
    }
    return { kind: "none" };
  }

  try {
    const parsed = JSON.parse(match.content) as unknown;
    if (!isDataMigrationPackage(parsed)) {
      throw new Error("JSON 结构不符合数据迁移格式");
    }
    if (parsed.schema !== DATA_MIGRATION_SCHEMA) {
      throw new Error("数据迁移 schema 不匹配");
    }
    if (parsed.version !== DATA_MIGRATION_VERSION) {
      throw new Error(`不支持的数据迁移版本：${parsed.version}`);
    }
    return { kind: "package", package: parsed };
  } catch (error) {
    return {
      kind: "invalid",
      issues: [
        {
          line: match.line,
          raw: firstNonEmptyLine(match.content),
          message: error instanceof Error ? error.message : "数据迁移 JSON 解析失败",
          blocking: true
        }
      ]
    };
  }
}

export function summarizeDataMigrationPackage(records: DataMigrationPackage): DataMigrationSummary {
  const tasks = records.tasks.map(dataMigrationRecordToTask);
  return {
    version: records.version,
    exportedAt: records.exportedAt,
    projects: records.projects.length,
    progressPages: records.progressPages.length,
    tasks: records.tasks.length,
    occurrences: tasks.reduce((count, task) => count + task.occurrenceDates.length, 0),
    compositeTasks: tasks.filter((task) => task.kind === "composite").length,
    mindmapLinks: tasks.filter((task) => Boolean(task.viewState?.mindmap?.parentTaskId)).length,
    ganttDependencies: tasks.reduce((count, task) => count + (task.viewState?.gantt?.dependencyIds?.length ?? 0), 0),
    mindmapComments: tasks.reduce((count, task) => count + task.mindmapComments.length, 0),
    taskNotes: tasks.reduce((count, task) => count + task.notes.length, 0),
    sourceLinks: tasks.reduce((count, task) => count + task.sourceLinks.length, 0),
    occurrenceStates: tasks.reduce((count, task) => count + task.occurrenceStates.length, 0),
    occurrenceOverrides: tasks.reduce((count, task) => count + task.occurrenceOverrides.length, 0)
  };
}

export function dataMigrationPackageToTasks(records: DataMigrationPackage): Task[] {
  return records.tasks.map(dataMigrationRecordToTask);
}

export function buildDataMigrationProjectPlan(projects: Project[], existingProjects: Project[]): DataMigrationProjectPlan {
  const projectIdBySourceId = new Map<string, string>();
  const newProjectNames: string[] = [];
  const projectByTargetId = new Map<string, Project>();

  projects.forEach((project) => {
    const existing = existingProjects.find((candidate) => candidate.id === project.id) ?? existingProjects.find((candidate) => candidate.name === project.name);
    const targetId = existing?.id ?? project.id;
    projectIdBySourceId.set(project.id, targetId);
    if (!existing) {
      newProjectNames.push(project.name);
    }
    projectByTargetId.set(targetId, { ...project, id: targetId });
  });

  return {
    projectIdBySourceId,
    projects: [...projectByTargetId.values()],
    newProjectNames
  };
}

export function buildDataMigrationTaskPlan(tasks: Task[], existingTasks: Task[], projectIdBySourceId: Map<string, string>): DataMigrationTaskPlan {
  const taskIdBySourceId = new Map<string, string>();
  const matchedTargetIds = new Set<string>();
  const replacedTaskIds: string[] = [];
  let createCount = 0;
  let overwriteCount = 0;

  tasks.forEach((task) => {
    const projectId = task.projectId ? projectIdBySourceId.get(task.projectId) ?? task.projectId : undefined;
    const existingById = existingTasks.find((candidate) => candidate.id === task.id);
    const existingByIdentity = existingById ? undefined : findTaskByMigrationIdentity(existingTasks, task.title, projectId, task.date);
    const existing = existingById ?? existingByIdentity;
    const targetId = existing && !matchedTargetIds.has(existing.id) ? existing.id : task.id;
    taskIdBySourceId.set(task.id, targetId);
    if (existing && targetId === existing.id) {
      matchedTargetIds.add(existing.id);
      replacedTaskIds.push(existing.id);
      overwriteCount += 1;
    } else {
      createCount += 1;
    }
  });

  return {
    taskIdBySourceId,
    tasks,
    replacedTaskIds,
    createCount,
    overwriteCount
  };
}

export function findTaskByMigrationIdentity(tasks: Task[], title: string, projectId: string | undefined, date: string): Task | undefined {
  return tasks
    .filter((task) => normalizeImportIdentity(task.title) === normalizeImportIdentity(title) && (task.projectId ?? undefined) === projectId)
    .find((task) => task.occurrenceDates.includes(date));
}

export function taskToDataMigrationImportInput(task: Task, projectId?: string): TaskInput {
  return {
    kind: task.kind,
    title: task.title,
    description: task.description,
    projectId,
    status: task.status,
    priority: task.priority,
    tags: [...task.tags],
    date: task.date,
    startTime: task.startTime,
    endTime: task.endTime,
    recurrence: task.recurrence,
    recurrenceCount: task.recurrenceCount ?? null,
    recurrenceUntil: task.recurrenceUntil ?? null,
    occurrenceDates: [...task.occurrenceDates],
    completedOccurrenceDates: task.occurrenceStates.filter((state) => Boolean(state.completedAt)).map((state) => state.date),
    occurrenceOverrides: task.occurrenceOverrides.map((override) => ({ ...override })),
    subtasks: [],
    viewState: cloneViewState(task.viewState),
    sourceLinks: task.sourceLinks.map((source) => ({ ...source })),
    notes: task.notes.map((note) => ({ ...note })),
    mindmapComments: task.mindmapComments.map((comment) => ({ ...comment })),
    completed: isTaskFullyCompleted(task)
  };
}

export function remapDataMigrationProgressPages(
  pages: ProgressPage[],
  projectIdBySourceId: Map<string, string>,
  existingPages: ProgressPage[]
): ProgressPage[] {
  const pageByTargetId = new Map<string, ProgressPage>();
  pages.forEach((page) => {
    const projectId = projectIdBySourceId.get(page.projectId) ?? page.projectId;
    const existing = existingPages.find((candidate) => candidate.id === page.id) ?? existingPages.find((candidate) => candidate.projectId === projectId);
    const id = existing?.id ?? page.id;
    pageByTargetId.set(id, {
      ...page,
      id,
      projectId,
      columnOrder: [...page.columnOrder]
    });
  });
  return [...pageByTargetId.values()];
}

export function remapDataMigrationTask(task: Task, taskIdBySourceId: Map<string, string>, projectIdBySourceId: Map<string, string>): Task {
  const id = taskIdBySourceId.get(task.id) ?? task.id;
  const projectId = task.projectId ? projectIdBySourceId.get(task.projectId) ?? task.projectId : undefined;
  return {
    ...task,
    id,
    projectId,
    tags: [...task.tags],
    subtasks: [],
    occurrenceDates: [...task.occurrenceDates],
    occurrenceStates: task.occurrenceStates.map((state) => ({
      ...state,
      completedSubtaskIds: [...(state.completedSubtaskIds ?? [])]
    })),
    occurrenceOverrides: task.occurrenceOverrides.map((override) => ({ ...override })),
    viewState: remapDataMigrationViewState(task.viewState, taskIdBySourceId),
    sourceLinks: task.sourceLinks.map((source) => ({ ...source })),
    notes: task.notes.map((note) => ({ ...note })),
    mindmapComments: task.mindmapComments.map((comment) => ({ ...comment, taskId: id }))
  };
}

function taskToDataMigrationRecord(task: Task): DataMigrationTaskRecord {
  const status = task.status ?? "todo";
  const recurrence = task.recurrence ?? "once";
  const record: DataMigrationTaskRecord = {
    id: task.id,
    title: task.title,
    date: task.date,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    revision: task.revision
  };
  if (task.kind !== "simple") {
    record.kind = task.kind;
  }
  if (task.description?.trim()) {
    record.description = task.description;
  }
  if (task.projectId) {
    record.projectId = task.projectId;
  }
  if (status !== "todo") {
    record.status = status;
  }
  if (task.priority) {
    record.priority = task.priority;
  }
  if (task.tags.length > 0) {
    record.tags = [...task.tags];
  }
  if (task.startTime) {
    record.startTime = task.startTime;
  }
  if (task.endTime) {
    record.endTime = task.endTime;
  }
  if (recurrence !== "once") {
    record.recurrence = recurrence;
  }
  if (task.recurrenceCount !== null && task.recurrenceCount !== undefined) {
    record.recurrenceCount = task.recurrenceCount;
  }
  if (task.recurrenceUntil) {
    record.recurrenceUntil = task.recurrenceUntil;
  }
  const occurrencePlan = buildOccurrencePlan(task);
  if (occurrencePlan) {
    record.occurrencePlan = occurrencePlan;
  }
  if (task.occurrenceStates.length > 0) {
    record.occurrenceStates = task.occurrenceStates.map((state) => ({
      ...state,
      completedSubtaskIds: [...(state.completedSubtaskIds ?? [])]
    }));
  }
  if (task.occurrenceOverrides.length > 0) {
    record.occurrenceOverrides = task.occurrenceOverrides.map((override) => ({ ...override }));
  }
  if (!isDefaultViewState(task.viewState, status)) {
    record.viewState = cloneViewState(task.viewState);
  }
  if (task.sourceLinks.length > 0) {
    record.sourceLinks = task.sourceLinks.map((source) => ({ ...source }));
  }
  if (task.notes.length > 0) {
    record.notes = task.notes.map((note) => ({ ...note }));
  }
  if (task.mindmapComments.length > 0) {
    record.mindmapComments = task.mindmapComments.map((comment) => ({ ...comment }));
  }
  return record;
}

function dataMigrationRecordToTask(record: DataMigrationTaskRecord): Task {
  const status = normalizeTaskStatus(record.status);
  const recurrence = normalizeTaskRecurrence(record.recurrence, record.occurrencePlan);
  const occurrenceDates = buildOccurrenceDatesFromRecord(record, recurrence);
  const date = occurrenceDates[0] ?? record.date;
  return {
    id: record.id,
    kind: record.kind === "composite" ? "composite" : "simple",
    title: record.title,
    description: record.description ?? "",
    projectId: record.projectId,
    status,
    priority: normalizeTaskPriority(record.priority),
    tags: [...(record.tags ?? [])],
    date,
    startTime: record.startTime,
    endTime: record.endTime,
    recurrence,
    recurrenceCount: record.recurrenceCount ?? null,
    recurrenceUntil: record.recurrenceUntil ?? null,
    subtasks: [],
    occurrenceDates,
    occurrenceStates: (record.occurrenceStates ?? []).map((state) => ({
      ...state,
      completedSubtaskIds: [...(state.completedSubtaskIds ?? [])]
    })),
    occurrenceOverrides: (record.occurrenceOverrides ?? []).map((override) => ({ ...override })),
    viewState: mergeViewState(record.viewState, status),
    sourceLinks: (record.sourceLinks ?? []).map((source) => ({ ...source })),
    notes: (record.notes ?? []).map((note) => ({ ...note })),
    mindmapComments: (record.mindmapComments ?? []).map((comment) => ({ ...comment })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision ?? 1
  };
}

function buildOccurrencePlan(task: Task): DataMigrationOccurrencePlan | undefined {
  const actualDates = normalizeDateList(task.occurrenceDates);
  if (task.recurrence === "custom") {
    return {
      source: "dates",
      ...packDateSet(actualDates)
    };
  }

  const generatedDates = generateRecurrenceDates({
    date: task.date,
    recurrence: task.recurrence,
    recurrenceCount: task.recurrenceCount ?? null,
    recurrenceUntil: task.recurrenceUntil ?? null
  });
  if (sameDateList(actualDates, generatedDates)) {
    return undefined;
  }

  const actual = new Set(actualDates);
  const generated = new Set(generatedDates);
  const exclude = generatedDates.filter((date) => !actual.has(date));
  const include = actualDates.filter((date) => !generated.has(date));
  const plan: Extract<DataMigrationOccurrencePlan, { source: "recurrence" }> = { source: "recurrence" };
  if (exclude.length > 0) {
    plan.exclude = packDateSet(exclude);
  }
  if (include.length > 0) {
    plan.include = packDateSet(include);
  }
  return plan.exclude || plan.include ? plan : undefined;
}

function buildOccurrenceDatesFromRecord(record: DataMigrationTaskRecord, recurrence: TaskRecurrence): string[] {
  const plan = record.occurrencePlan;
  if (plan?.source === "dates") {
    return expandDateSet(plan);
  }
  const generated = generateRecurrenceDates({
    date: record.date,
    recurrence,
    recurrenceCount: record.recurrenceCount ?? null,
    recurrenceUntil: record.recurrenceUntil ?? null
  });
  if (plan?.source !== "recurrence") {
    return generated;
  }
  const exclude = new Set(plan.exclude ? expandDateSet(plan.exclude) : []);
  const include = plan.include ? expandDateSet(plan.include) : [];
  return normalizeDateList([...generated.filter((date) => !exclude.has(date)), ...include]);
}

function generateRecurrenceDates(input: {
  date: string;
  recurrence: TaskRecurrence;
  recurrenceCount?: number | null;
  recurrenceUntil?: string | null;
}): string[] {
  if (input.recurrence === "custom") {
    return [input.date];
  }
  const countLimit = input.recurrenceCount ?? (input.recurrence === "once" ? 1 : 365);
  const until = input.recurrenceUntil ?? null;
  const dates: string[] = [];
  let cursor = parseDateKey(input.date);
  let createdCount = 0;

  while (true) {
    const dateKey = toDateKey(cursor);
    if (until && compareDateKeys(dateKey, until) > 0) {
      break;
    }
    if (input.recurrence !== "once" && input.recurrenceCount && createdCount >= input.recurrenceCount) {
      break;
    }
    if (input.recurrence === "once" && createdCount >= 1) {
      break;
    }

    dates.push(dateKey);
    createdCount += 1;

    if (input.recurrence === "once") {
      break;
    }

    cursor = addDays(cursor, input.recurrence === "daily" ? 1 : 7);
    if (createdCount >= countLimit && !input.recurrenceCount) {
      break;
    }
  }

  return dates.length > 0 ? dates : [input.date];
}

function packDateSet(dates: string[]): DataMigrationDateSet {
  const normalized = normalizeDateList(dates);
  const singles: string[] = [];
  const ranges: DataMigrationDateRange[] = [];
  let index = 0;
  while (index < normalized.length) {
    const dailyRun = collectDateRun(normalized, index, 1);
    if (dailyRun.length >= 3) {
      ranges.push({ from: dailyRun[0], to: dailyRun[dailyRun.length - 1], every: "day" });
      index += dailyRun.length;
      continue;
    }
    const weeklyRun = collectDateRun(normalized, index, 7);
    if (weeklyRun.length >= 3) {
      ranges.push({ from: weeklyRun[0], to: weeklyRun[weeklyRun.length - 1], every: "week" });
      index += weeklyRun.length;
      continue;
    }
    singles.push(normalized[index]);
    index += 1;
  }

  return {
    ...(singles.length > 0 ? { dates: singles } : {}),
    ...(ranges.length > 0 ? { ranges } : {})
  };
}

function collectDateRun(dates: string[], startIndex: number, stepDays: number): string[] {
  const run = [dates[startIndex]];
  let cursor = parseDateKey(dates[startIndex]);
  for (let index = startIndex + 1; index < dates.length; index += 1) {
    cursor = addDays(cursor, stepDays);
    const expected = toDateKey(cursor);
    if (dates[index] !== expected) {
      break;
    }
    run.push(dates[index]);
  }
  return run;
}

function expandDateSet(set: DataMigrationDateSet): string[] {
  const dates = [...(set.dates ?? [])];
  (set.ranges ?? []).forEach((range) => {
    let cursor = parseDateKey(range.from);
    const step = range.every === "week" ? 7 : 1;
    while (compareDateKeys(toDateKey(cursor), range.to) <= 0) {
      dates.push(toDateKey(cursor));
      cursor = addDays(cursor, step);
    }
  });
  return normalizeDateList(dates);
}

function normalizeDateList(dates: string[]): string[] {
  return [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort(compareDateKeys);
}

function sameDateList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((date, index) => date === right[index]);
}

function normalizeTaskRecurrence(value: TaskRecurrence | undefined, occurrencePlan?: DataMigrationOccurrencePlan): TaskRecurrence {
  if (value === "daily" || value === "weekly" || value === "custom") {
    return value;
  }
  return occurrencePlan?.source === "dates" ? "custom" : "once";
}

function normalizeTaskStatus(value?: TaskStatus): TaskStatus {
  return value === "doing" || value === "blocked" || value === "done" ? value : "todo";
}

function normalizeTaskPriority(value?: TaskPriority): TaskPriority | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "urgent") {
    return value;
  }
  return undefined;
}

function defaultTaskViewState(status: TaskStatus): TaskViewState {
  return {
    board: {
      columnId: status,
      order: 0
    },
    gantt: {
      rowOrder: 0,
      dependencyIds: [],
      locked: false,
      milestone: false
    },
    mindmap: {
      parentTaskId: null,
      childOrder: 0,
      expanded: true
    }
  };
}

function mergeViewState(patch: Partial<TaskViewState> | undefined, status: TaskStatus): TaskViewState {
  const base = defaultTaskViewState(status);
  return {
    board: {
      columnId: patch?.board?.columnId ?? base.board.columnId,
      order: patch?.board?.order ?? base.board.order
    },
    gantt: {
      rowOrder: patch?.gantt?.rowOrder ?? base.gantt.rowOrder,
      dependencyIds: [...(patch?.gantt?.dependencyIds ?? base.gantt.dependencyIds)],
      locked: patch?.gantt?.locked ?? base.gantt.locked,
      milestone: patch?.gantt?.milestone ?? base.gantt.milestone
    },
    mindmap: {
      parentTaskId: patch?.mindmap?.parentTaskId === undefined ? base.mindmap.parentTaskId : patch.mindmap.parentTaskId,
      childOrder: patch?.mindmap?.childOrder ?? base.mindmap.childOrder,
      expanded: patch?.mindmap?.expanded ?? base.mindmap.expanded,
      x: patch?.mindmap?.x,
      y: patch?.mindmap?.y
    }
  };
}

function isDefaultViewState(viewState: TaskViewState, status: TaskStatus): boolean {
  const base = defaultTaskViewState(status);
  return (
    viewState.board.columnId === base.board.columnId &&
    viewState.board.order === base.board.order &&
    viewState.gantt.rowOrder === base.gantt.rowOrder &&
    viewState.gantt.dependencyIds.length === 0 &&
    viewState.gantt.locked === base.gantt.locked &&
    viewState.gantt.milestone === base.gantt.milestone &&
    (viewState.mindmap.parentTaskId ?? null) === base.mindmap.parentTaskId &&
    viewState.mindmap.childOrder === base.mindmap.childOrder &&
    viewState.mindmap.expanded === base.mindmap.expanded &&
    viewState.mindmap.x === undefined &&
    viewState.mindmap.y === undefined
  );
}

function cloneViewState(viewState: TaskViewState): TaskViewState {
  return {
    board: { ...viewState.board },
    gantt: {
      ...viewState.gantt,
      dependencyIds: [...viewState.gantt.dependencyIds]
    },
    mindmap: { ...viewState.mindmap }
  };
}

function remapDataMigrationViewState(viewState: TaskViewState, taskIdBySourceId: Map<string, string>): TaskViewState {
  const parentTaskId = viewState.mindmap.parentTaskId ?? null;
  return {
    board: {
      ...viewState.board
    },
    gantt: {
      ...viewState.gantt,
      dependencyIds: viewState.gantt.dependencyIds.map((id) => taskIdBySourceId.get(id) ?? id)
    },
    mindmap: {
      ...viewState.mindmap,
      parentTaskId: parentTaskId ? taskIdBySourceId.get(parentTaskId) ?? parentTaskId : parentTaskId
    }
  };
}

function isTaskFullyCompleted(task: Task): boolean {
  return task.occurrenceDates.every((date) => isOccurrenceCompleted(task, date));
}

function isOccurrenceCompleted(task: Task, date: string): boolean {
  const state = task.occurrenceStates.find((item) => item.date === date);
  if (task.kind === "simple") {
    return Boolean(state);
  }
  if (task.subtasks.length === 0) {
    return Boolean(state?.completedAt);
  }
  const completedIds = new Set(state?.completedSubtaskIds ?? []);
  return task.subtasks.every((subtask) => completedIds.has(subtask.id));
}

function normalizeImportIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-Hans-CN");
}

function findDataMigrationJson(text: string): { content: string; line: number } | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return { content: trimmed, line: 1 };
  }
  const fence = new RegExp("```\\s*" + DATA_MIGRATION_FENCE + "\\s*\\r?\\n([\\s\\S]*?)```", "i");
  const match = fence.exec(text);
  if (!match) {
    return null;
  }
  const before = text.slice(0, match.index);
  return {
    content: match[1].trim(),
    line: before.split(/\r?\n/).length
  };
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function isDataMigrationPackage(value: unknown): value is DataMigrationPackage {
  return (
    isRecord(value) &&
    value.schema === DATA_MIGRATION_SCHEMA &&
    value.version === DATA_MIGRATION_VERSION &&
    typeof value.exportedAt === "string" &&
    Array.isArray(value.projects) &&
    value.projects.every(isProjectRecord) &&
    Array.isArray(value.progressPages) &&
    value.progressPages.every(isProgressPageRecord) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isDataMigrationTaskRecord)
  );
}

function isProjectRecord(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isProgressPageRecord(value: unknown): value is ProgressPage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.columnOrder) &&
    value.columnOrder.every((item) => typeof item === "string")
  );
}

function isDataMigrationTaskRecord(value: unknown): value is DataMigrationTaskRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.date === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.kind === undefined || value.kind === "simple" || value.kind === "composite") &&
    (value.status === undefined || ["todo", "doing", "blocked", "done"].includes(String(value.status))) &&
    (value.recurrence === undefined || ["once", "daily", "weekly", "custom"].includes(String(value.recurrence))) &&
    (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string"))) &&
    (value.subtasks === undefined || (Array.isArray(value.subtasks) && value.subtasks.every(isTaskSubtaskRecord))) &&
    (value.occurrenceStates === undefined || (Array.isArray(value.occurrenceStates) && value.occurrenceStates.every(isOccurrenceStateRecord))) &&
    (value.occurrenceOverrides === undefined ||
      (Array.isArray(value.occurrenceOverrides) && value.occurrenceOverrides.every(isOccurrenceOverrideRecord))) &&
    (value.mindmapComments === undefined || (Array.isArray(value.mindmapComments) && value.mindmapComments.every(isMindmapCommentRecord))) &&
    (value.sourceLinks === undefined || Array.isArray(value.sourceLinks)) &&
    (value.notes === undefined || Array.isArray(value.notes)) &&
    (value.viewState === undefined || isRecord(value.viewState)) &&
    (value.occurrencePlan === undefined || isOccurrencePlanRecord(value.occurrencePlan))
  );
}

function isTaskSubtaskRecord(value: unknown): value is TaskSubtask {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function isOccurrenceStateRecord(value: unknown): value is TaskOccurrenceState {
  return isRecord(value) && typeof value.date === "string";
}

function isOccurrenceOverrideRecord(value: unknown): value is TaskOccurrenceOverride {
  return isRecord(value) && typeof value.date === "string";
}

function isMindmapCommentRecord(value: unknown): value is TaskMindmapComment {
  return isRecord(value) && typeof value.id === "string" && typeof value.taskId === "string" && typeof value.content === "string";
}

function isOccurrencePlanRecord(value: unknown): value is DataMigrationOccurrencePlan {
  if (!isRecord(value)) {
    return false;
  }
  if (value.source === "dates") {
    return isDateSetRecord(value);
  }
  if (value.source === "recurrence") {
    return (
      (value.exclude === undefined || isDateSetRecord(value.exclude)) &&
      (value.include === undefined || isDateSetRecord(value.include))
    );
  }
  return false;
}

function isDateSetRecord(value: unknown): value is DataMigrationDateSet {
  return (
    isRecord(value) &&
    (value.dates === undefined || (Array.isArray(value.dates) && value.dates.every((date) => typeof date === "string"))) &&
    (value.ranges === undefined || (Array.isArray(value.ranges) && value.ranges.every(isDateRangeRecord)))
  );
}

function isDateRangeRecord(value: unknown): value is DataMigrationDateRange {
  return (
    isRecord(value) &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    (value.every === "day" || value.every === "week")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
