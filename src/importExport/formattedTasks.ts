import {
  Project,
  Task,
  TaskImportCompletionMode,
  TaskImportPreview,
  TaskInput,
  TaskKind,
  TaskPriority,
  TaskRecurrence,
  TaskSourceLink,
  TaskStatus,
  TaskSubtask,
  TaskSubtaskInput
} from "../types";
import { compareDateKeys } from "../utils/date";

export const UNASSIGNED_PROJECT_LABEL = "未归属项目";

export type ParsedImportTask = {
  line: number;
  raw: string;
  input: TaskInput;
  projectName?: string;
  completionMode: TaskImportCompletionMode;
  createReady: boolean;
};

export function parseFormattedTaskText(
  text: string,
  options: {
    projects: Project[];
    projectId?: string;
    defaultDate: string;
    source?: TaskSourceLink;
  }
): { tasks: ParsedImportTask[]; issues: TaskImportPreview["issues"] } {
  const tasks: ParsedImportTask[] = [];
  const issues: TaskImportPreview["issues"] = [];
  const lines = text.split(/\r?\n/);
  let currentProjectId = options.projectId;
  let currentProjectName = options.projectId ? options.projects.find((project) => project.id === options.projectId)?.name : undefined;
  let currentTask: ParsedImportTask | null = null;

  const flushCurrent = (): void => {
    if (currentTask) {
      tasks.push(currentTask);
      currentTask = null;
    }
  };

  lines.forEach((line, index) => {
    const raw = line;
    const projectMatch = /^\s*#项目[:：]\s*(.*?)\s*$/.exec(line);
    if (projectMatch) {
      flushCurrent();
      const projectName = projectMatch[1].trim() || UNASSIGNED_PROJECT_LABEL;
      if (projectName === UNASSIGNED_PROJECT_LABEL) {
        currentProjectId = undefined;
        currentProjectName = UNASSIGNED_PROJECT_LABEL;
        return;
      }
      const existingProject = options.projects.find((project) => project.name === projectName || project.id === projectName);
      currentProjectId = existingProject?.id;
      currentProjectName = existingProject?.name ?? projectName;
      return;
    }

    const plannedTaskMatch = /^(\s*)\+\s*(任务|task|组合|composite)[:：]\s+(.+)$/.exec(line);
    if (plannedTaskMatch && plannedTaskMatch[1].length === 0) {
      flushCurrent();
      try {
        const prefix = plannedTaskMatch[2].toLowerCase();
        const parsed = parseTaskLine(plannedTaskMatch[3], {
          completed: false,
          forcedKind: prefix === "组合" || prefix === "composite" ? "composite" : "simple",
          projectId: currentProjectId,
          projectName: currentProjectName,
          defaultDate: options.defaultDate,
          source: options.source
        });
        currentTask = {
          line: index + 1,
          raw,
          input: parsed.input,
          projectName: parsed.projectName,
          completionMode: parsed.completionMode,
          createReady: parsed.createReady
        };
      } catch (error) {
        issues.push({ line: index + 1, message: error instanceof Error ? error.message : "任务解析失败", raw });
      }
      return;
    }

    const taskMatch = /^(\s*)-\s+\[( |x|X)\]\s+(.+)$/.exec(line);
    if (taskMatch && taskMatch[1].length === 0) {
      flushCurrent();
      try {
        const parsed = parseTaskLine(taskMatch[3], {
          completed: taskMatch[2].toLowerCase() === "x",
          projectId: currentProjectId,
          projectName: currentProjectName,
          defaultDate: options.defaultDate,
          source: options.source
        });
        currentTask = {
          line: index + 1,
          raw,
          input: parsed.input,
          projectName: parsed.projectName,
          completionMode: parsed.completionMode,
          createReady: parsed.createReady
        };
      } catch (error) {
        issues.push({ line: index + 1, message: error instanceof Error ? error.message : "任务解析失败", raw });
      }
      return;
    }

    const subtaskMatch = /^\s{2,}-\s+(.+)$/.exec(line);
    if (subtaskMatch && currentTask) {
      currentTask.input.kind = "composite";
      const subtask = parseSubtaskLine(subtaskMatch[1]);
      currentTask.input.subtasks = [
        ...(currentTask.input.subtasks ?? []),
        { ...subtask, order: currentTask.input.subtasks?.length ?? 0 }
      ];
      return;
    }

    const descriptionMatch = /^\s{2,}>\s?(.*)$/.exec(line);
    if (descriptionMatch && currentTask) {
      currentTask.input.description = [currentTask.input.description, descriptionMatch[1]].filter(Boolean).join("\n");
      return;
    }

    if (line.trim()) {
      issues.push({ line: index + 1, message: "无法识别的行", raw });
    }
  });
  flushCurrent();
  return { tasks, issues };
}

export function renderTaskListForImport(tasks: Task[], projectNameForId: (projectId?: string) => string | undefined): string {
  const grouped = new Map<string, Task[]>();
  tasks.forEach((task) => {
    const key = task.projectId ?? UNASSIGNED_PROJECT_LABEL;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  });

  const sections: string[] = [];
  [...grouped.entries()].forEach(([projectKey, projectTasks], index) => {
    if (index > 0) {
      sections.push("");
    }
    sections.push(`#项目：${projectKey === UNASSIGNED_PROJECT_LABEL ? UNASSIGNED_PROJECT_LABEL : projectNameForId(projectKey) ?? UNASSIGNED_PROJECT_LABEL}`);
    projectTasks.slice().sort(compareSeriesTasksForExport).forEach((task) => {
      sections.push(renderTaskSeriesForExport(task));
      renderDescriptionForExport(task.description).forEach((line) => {
        sections.push(line);
      });
      if (task.kind === "composite") {
        task.subtasks.forEach((subtask) => {
          sections.push(renderSubtaskForExport(subtask));
        });
      }
    });
  });

  return sections.join("\n").trim();
}

export function renderTaskSeriesForExport(task: Task): string {
  const completedOccurrenceDates = getCompletedOccurrenceDates(task);
  const parts = buildFormattedTaskParts({ ...task, completedOccurrenceDates }, { includeKind: false });
  const prefix = task.kind === "composite" ? "组合" : "任务";
  return `+ ${prefix}：${parts.join(" ")}`.trim();
}

export function renderSubtaskForExport(subtask: TaskSubtask): string {
  const time = subtask.startTime && subtask.endTime ? ` @${subtask.startTime}-${subtask.endTime}` : "";
  return `  - ${subtask.title}${time}`;
}

export function renderDescriptionForExport(description?: string): string[] {
  const trimmed = description?.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(/\r?\n/).map((line) => `  > ${line}`);
}

export function extractProjectTaskBlocks(text: string): string {
  const blocks = [...text.matchAll(/<!--\s*pm:start\s*-->([\s\S]*?)<!--\s*pm:end\s*-->/g)].map((match) => match[1].trim());
  return blocks.length > 0 ? blocks.join("\n") : "";
}

function parseSubtaskLine(raw: string): TaskSubtaskInput {
  const match = /\s@(\d{2}:\d{2})-(\d{2}:\d{2})\s*$/.exec(raw);
  const title = raw.replace(/\s@\d{2}:\d{2}-\d{2}:\d{2}\s*$/, "").trim();
  return {
    title,
    startTime: match?.[1],
    endTime: match?.[2]
  };
}

function parseTaskLine(
  rawTitle: string,
  context: {
    completed: boolean;
    forcedKind?: TaskKind;
    projectId?: string;
    projectName?: string;
    defaultDate: string;
    source?: TaskSourceLink;
  }
): { input: TaskInput; projectName?: string; completionMode: TaskImportCompletionMode; createReady: boolean } {
  let title = rawTitle.trim();
  const dateMatch = /@(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})-(\d{2}:\d{2}))?/.exec(title);
  const kindMatch = /\b(?:kind|type):(simple|composite)\b/.exec(title);
  const repeatMatch = /\brepeat:(once|daily|weekly|custom)\b/.exec(title);
  const countMatch = /\bcount:(\d+)\b/.exec(title);
  const untilMatch = /\buntil:(\d{4}-\d{2}-\d{2})\b/.exec(title);
  const datesMatch = /\bdates:((?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*)\b/.exec(title);
  const doneMatch = /\bdone:((?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*)\b/.exec(title);
  const statusMatch = /\bstatus:(todo|doing|blocked|done)\b/.exec(title);
  const finishMatch = /\bfinish:(today|series)\b/.exec(title);
  const priorityMatch = /!(low|medium|high|urgent)\b/.exec(title);
  const tags = [...title.matchAll(/#([^\s#]+)/g)].map((match) => match[1]).filter((tag) => !tag.startsWith("项目"));
  const customDates = datesMatch?.[1].split(",").filter(Boolean) ?? [];
  const completedDates = doneMatch?.[1].split(",").filter(Boolean) ?? [];

  title = title
    .replace(/@\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}-\d{2}:\d{2})?/g, "")
    .replace(/\b(?:kind|type):(simple|composite)\b/g, "")
    .replace(/\brepeat:(once|daily|weekly|custom)\b/g, "")
    .replace(/\bcount:\d+\b/g, "")
    .replace(/\buntil:\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\bdates:(?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*\b/g, "")
    .replace(/\bdone:(?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*\b/g, "")
    .replace(/\bstatus:(todo|doing|blocked|done)\b/g, "")
    .replace(/\bfinish:(today|series)\b/g, "")
    .replace(/!(low|medium|high|urgent)\b/g, "")
    .replace(/#[^\s#]+/g, "")
    .trim();

  if (!title) {
    throw new Error("任务标题不能为空");
  }

  return {
    input: {
      kind: (kindMatch?.[1] as TaskKind | undefined) ?? context.forcedKind ?? "simple",
      title,
      projectId: context.projectId,
      date: dateMatch?.[1] ?? customDates[0] ?? context.defaultDate,
      startTime: dateMatch?.[2],
      endTime: dateMatch?.[3],
      recurrence: (repeatMatch?.[1] as TaskRecurrence | undefined) ?? "once",
      recurrenceCount: countMatch ? Number(countMatch[1]) : null,
      recurrenceUntil: untilMatch?.[1] ?? null,
      occurrenceDates: customDates.length > 0 ? customDates : undefined,
      completedOccurrenceDates: completedDates.length > 0 ? completedDates : undefined,
      status: (statusMatch?.[1] as TaskStatus | undefined) ?? (context.completed ? "done" : "todo"),
      priority: priorityMatch?.[1] as TaskPriority | undefined,
      tags,
      sourceLinks: context.source ? [context.source] : [],
      completed: context.completed && completedDates.length === 0
    },
    projectName: context.projectName,
    completionMode: context.completed && completedDates.length === 0 ? ((finishMatch?.[1] as TaskImportCompletionMode | undefined) ?? "today") : "pending",
    createReady: Boolean(dateMatch?.[1] && dateMatch?.[2] && dateMatch?.[3])
  };
}

type FormattedTaskSource = {
  title: string;
  kind: TaskKind;
  date: string;
  startTime?: string;
  endTime?: string;
  tags: string[];
  priority?: TaskPriority;
  status: TaskStatus;
  recurrence: TaskRecurrence;
  recurrenceCount?: number | null;
  recurrenceUntil?: string | null;
  occurrenceDates?: string[];
  completedOccurrenceDates?: string[];
};

function buildFormattedTaskParts(task: FormattedTaskSource, options: { includeKind?: boolean } = {}): string[] {
  const parts = [task.title];
  if (options.includeKind !== false) {
    parts.push(`kind:${task.kind}`);
  }
  parts.push(`@${task.date}${task.startTime && task.endTime ? ` ${task.startTime}-${task.endTime}` : ""}`);
  task.tags.forEach((tag) => parts.push(`#${tag}`));
  if (task.priority) {
    parts.push(`!${task.priority}`);
  }
  parts.push(`status:${task.status}`);
  if (task.recurrence !== "once") {
    parts.push(`repeat:${task.recurrence}`);
  }
  if (task.recurrenceCount) {
    parts.push(`count:${task.recurrenceCount}`);
  }
  if (task.recurrenceUntil) {
    parts.push(`until:${task.recurrenceUntil}`);
  }
  if (task.recurrence === "custom" && task.occurrenceDates?.length) {
    parts.push(`dates:${[...new Set(task.occurrenceDates)].sort(compareDateKeys).join(",")}`);
  }
  if (task.completedOccurrenceDates?.length) {
    parts.push(`done:${[...new Set(task.completedOccurrenceDates)].sort(compareDateKeys).join(",")}`);
  }
  return parts;
}

function getCompletedOccurrenceDates(task: Task): string[] {
  return task.occurrenceDates.filter((date) => isOccurrenceCompleted(task, date));
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

function compareSeriesTasksForExport(a: Task, b: Task): number {
  return (
    compareDateKeys(a.date, b.date) ||
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    (a.endTime ?? "").localeCompare(b.endTime ?? "") ||
    a.title.localeCompare(b.title)
  );
}
