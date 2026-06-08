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
  TaskStatus
} from "../types";
import { compareDateKeys } from "../utils/date";

export const UNASSIGNED_PROJECT_LABEL = "未归属项目";

export type ParsedImportTask = {
  line: number;
  raw: string;
  input: TaskInput;
  projectName?: string;
  parentTitle?: string;
  dependencyTitles?: string[];
  completionMode: TaskImportCompletionMode;
  syntax: "planned" | "minimal";
  createReady: boolean;
  hasTimeRange: boolean;
};

export function parseFormattedTaskText(
  text: string,
  options: {
    projects: Project[];
    projectId?: string;
    strictProjectId?: string;
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
  let currentCompositeParentTitle: string | undefined;

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
      const strictProject = options.strictProjectId ? options.projects.find((project) => project.id === options.strictProjectId) : undefined;
      if (strictProject && projectName !== strictProject.name && projectName !== strictProject.id) {
        issues.push({
          line: index + 1,
          raw,
          blocking: true,
          message: `导入项目名必须是「${strictProject.name}」`
        });
        currentProjectId = strictProject.id;
        currentProjectName = strictProject.name;
        currentCompositeParentTitle = undefined;
        return;
      }
      if (projectName === UNASSIGNED_PROJECT_LABEL) {
        currentProjectId = strictProject?.id;
        currentProjectName = strictProject?.name ?? UNASSIGNED_PROJECT_LABEL;
        currentCompositeParentTitle = undefined;
        return;
      }
      const existingProject = options.projects.find((project) => project.name === projectName || project.id === projectName);
      currentProjectId = strictProject?.id ?? existingProject?.id;
      currentProjectName = strictProject?.name ?? existingProject?.name ?? projectName;
      currentCompositeParentTitle = undefined;
      return;
    }

    const plannedTaskMatch = /^(\s*)\+\s*(任务|task|组合|composite)[:：]\s*(.+)$/.exec(line);
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
          parentTitle: parsed.parentTitle,
          dependencyTitles: parsed.dependencyTitles,
          completionMode: parsed.completionMode,
          syntax: "planned",
          createReady: parsed.hasExplicitDate,
          hasTimeRange: parsed.hasTimeRange
        };
        currentCompositeParentTitle = currentTask.input.kind === "composite" ? currentTask.input.title : undefined;
      } catch (error) {
        issues.push({ line: index + 1, message: error instanceof Error ? error.message : "任务解析失败", raw });
      }
      return;
    }

    const childTaskMatch = /^(\s{2,})\+\s*(子任务|child)[:：]\s*(.+)$/.exec(line);
    if (childTaskMatch) {
      if (!currentCompositeParentTitle) {
        issues.push({ line: index + 1, message: "子任务必须写在组合任务下方", raw, blocking: true });
        return;
      }
      flushCurrent();
      try {
        const parsed = parseTaskLine(childTaskMatch[3], {
          completed: false,
          forcedKind: "simple",
          parentTitle: currentCompositeParentTitle,
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
          parentTitle: parsed.parentTitle,
          dependencyTitles: parsed.dependencyTitles,
          completionMode: parsed.completionMode,
          syntax: "planned",
          createReady: parsed.hasExplicitDate,
          hasTimeRange: parsed.hasTimeRange
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
          parentTitle: parsed.parentTitle,
          dependencyTitles: parsed.dependencyTitles,
          completionMode: parsed.completionMode,
          syntax: "minimal",
          createReady: false,
          hasTimeRange: parsed.hasTimeRange
        };
        currentCompositeParentTitle = undefined;
      } catch (error) {
        issues.push({ line: index + 1, message: error instanceof Error ? error.message : "任务解析失败", raw });
      }
      return;
    }

    const subtaskMatch = /^\s{2,}-\s+(.+)$/.exec(line);
    if (subtaskMatch && currentTask) {
      issues.push({ line: index + 1, message: "组合任务不再支持轻量项，请改用「  + 子任务：...」", raw, blocking: true });
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
      sections.push(renderTaskSeriesForExport(task, { dependencyTitleForId: (taskId) => projectTasks.find((item) => item.id === taskId)?.title }));
      renderDescriptionForExport(task.description).forEach((line) => {
        sections.push(line);
      });
    });
  });

  return sections.join("\n").trim();
}

export function renderTaskSeriesForExport(
  task: Task,
  options: {
    child?: boolean;
    dependencyTitleForId?: (taskId: string) => string | undefined;
  } = {}
): string {
  const parts = buildFormattedTaskParts(task, {
    includeKind: false,
    dependencyTitleForId: options.dependencyTitleForId
  });
  const prefix = options.child ? "  + 子任务" : task.kind === "composite" ? "+ 组合" : "+ 任务";
  return `${prefix}：${parts.join(" ")}`.trimEnd();
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

function parseTaskLine(
  rawTitle: string,
  context: {
    completed: boolean;
    forcedKind?: TaskKind;
    parentTitle?: string;
    projectId?: string;
    projectName?: string;
    defaultDate: string;
    source?: TaskSourceLink;
  }
): {
  input: TaskInput;
  projectName?: string;
  parentTitle?: string;
  dependencyTitles?: string[];
  completionMode: TaskImportCompletionMode;
  hasExplicitDate: boolean;
  hasTimeRange: boolean;
} {
  let title = rawTitle.trim();
  const dateMatch = /@(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})-(\d{2}:\d{2}))?/.exec(title);
  const kindMatch = /\b(?:kind|type):(simple|composite)\b/.exec(title);
  const repeatMatch = /\brepeat:(once|daily|weekly|custom)\b/.exec(title);
  const countMatch = /\bcount:(\d+)\b/.exec(title);
  const untilMatch = /\buntil:(\d{4}-\d{2}-\d{2})\b/.exec(title);
  const datesMatch = /\bdates:((?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*)\b/.exec(title);
  const statusMatch = /\bstatus:(todo|doing|blocked|done)\b/.exec(title);
  const finishMatch = /\bfinish:(today|series)\b/.exec(title);
  const priorityMatch = /!(low|medium|high|urgent)\b/.exec(title);
  const boardMatch = /\bboard:(todo|doing|blocked|done)(?::(-?\d+))?\b/.exec(title);
  const ganttMatch = /\bgantt:([^\s]+)/.exec(title);
  const mindmapMatch = /\bmindmap:([^\s]+)/.exec(title);
  const parentMatch = /\bparent:([^\s]+)/.exec(title);
  const depsMatch = /\bdeps:([^\s]+)/.exec(title);
  const tags = [...title.matchAll(/#([^\s#]+)/g)].map((match) => match[1]).filter((tag) => !tag.startsWith("项目"));
  const customDates = datesMatch?.[1].split(",").filter(Boolean) ?? [];
  const viewState = buildViewStatePatchFromTokens({
    status: (statusMatch?.[1] as TaskStatus | undefined) ?? (context.completed ? "done" : "todo"),
    board: boardMatch?.[1] as TaskStatus | undefined,
    boardOrder: boardMatch?.[2] ? Number(boardMatch[2]) : undefined,
    gantt: ganttMatch?.[1],
    mindmap: mindmapMatch?.[1]
  });
  const parentTitle = context.parentTitle ?? (parentMatch ? decodeReferenceToken(parentMatch[1]) : undefined);
  const dependencyTitles = depsMatch ? depsMatch[1].split("|").map(decodeReferenceToken).filter(Boolean) : [];

  title = title
    .replace(/@\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}-\d{2}:\d{2})?/g, "")
    .replace(/\b(?:kind|type):(simple|composite)\b/g, "")
    .replace(/\brepeat:(once|daily|weekly|custom)\b/g, "")
    .replace(/\bcount:\d+\b/g, "")
    .replace(/\buntil:\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\bdates:(?:\d{4}-\d{2}-\d{2})(?:,\d{4}-\d{2}-\d{2})*\b/g, "")
    .replace(/\bstatus:(todo|doing|blocked|done)\b/g, "")
    .replace(/\bfinish:(today|series)\b/g, "")
    .replace(/\bboard:(todo|doing|blocked|done)(?::[-]?\d+)?\b/g, "")
    .replace(/\bgantt:[^\s]+/g, "")
    .replace(/\bmindmap:[^\s]+/g, "")
    .replace(/\bparent:[^\s]+/g, "")
    .replace(/\bdeps:[^\s]+/g, "")
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
      status: (statusMatch?.[1] as TaskStatus | undefined) ?? (context.completed ? "done" : "todo"),
      priority: priorityMatch?.[1] as TaskPriority | undefined,
      tags,
      viewState,
      sourceLinks: context.source ? [context.source] : [],
      completed: context.completed
    },
    projectName: context.projectName,
    parentTitle,
    dependencyTitles,
    completionMode: context.completed ? ((finishMatch?.[1] as TaskImportCompletionMode | undefined) ?? "today") : "pending",
    hasExplicitDate: Boolean(dateMatch?.[1]),
    hasTimeRange: Boolean(dateMatch?.[2] && dateMatch?.[3])
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
  viewState?: Task["viewState"];
};

function buildFormattedTaskParts(
  task: FormattedTaskSource,
  options: {
    includeKind?: boolean;
    dependencyTitleForId?: (taskId: string) => string | undefined;
  } = {}
): string[] {
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
  if (task.viewState) {
    parts.push(`board:${task.viewState.board.columnId}:${task.viewState.board.order}`);
    const ganttParts = [`order=${task.viewState.gantt.rowOrder}`];
    if (task.viewState.gantt.locked) {
      ganttParts.push("locked");
    }
    if (task.viewState.gantt.milestone) {
      ganttParts.push("milestone");
    }
    parts.push(`gantt:${ganttParts.join(",")}`);
    const dependencyTitles = task.viewState.gantt.dependencyIds
      .map((id) => options.dependencyTitleForId?.(id))
      .filter((title): title is string => Boolean(title));
    if (dependencyTitles.length > 0) {
      parts.push(`deps:${dependencyTitles.map(encodeReferenceToken).join("|")}`);
    }
    const mindmapParts = [
      `order=${task.viewState.mindmap.childOrder}`,
      task.viewState.mindmap.expanded ? "expanded" : "collapsed"
    ];
    if (Number.isFinite(task.viewState.mindmap.x)) {
      mindmapParts.push(`x=${task.viewState.mindmap.x}`);
    }
    if (Number.isFinite(task.viewState.mindmap.y)) {
      mindmapParts.push(`y=${task.viewState.mindmap.y}`);
    }
    parts.push(`mindmap:${mindmapParts.join(",")}`);
  }
  return parts;
}

function compareSeriesTasksForExport(a: Task, b: Task): number {
  return (
    compareDateKeys(a.date, b.date) ||
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    (a.endTime ?? "").localeCompare(b.endTime ?? "") ||
    a.title.localeCompare(b.title)
  );
}

function buildViewStatePatchFromTokens(input: {
  status: TaskStatus;
  board?: TaskStatus;
  boardOrder?: number;
  gantt?: string;
  mindmap?: string;
}): TaskInput["viewState"] {
  const viewState: TaskInput["viewState"] = {
    board: {
      columnId: input.board ?? input.status,
      order: Number.isFinite(input.boardOrder) ? input.boardOrder! : 0
    }
  };
  if (input.gantt) {
    const parts = input.gantt.split(",").map((part) => part.trim()).filter(Boolean);
    const orderPart = parts.find((part) => part.startsWith("order="));
    viewState.gantt = {
      rowOrder: orderPart ? Number(orderPart.slice("order=".length)) || 0 : 0,
      dependencyIds: [],
      locked: parts.includes("locked"),
      milestone: parts.includes("milestone")
    };
  }
  if (input.mindmap) {
    const parts = input.mindmap.split(",").map((part) => part.trim()).filter(Boolean);
    const orderPart = parts.find((part) => part.startsWith("order="));
    const xPart = parts.find((part) => part.startsWith("x="));
    const yPart = parts.find((part) => part.startsWith("y="));
    const x = xPart ? Number(xPart.slice("x=".length)) : undefined;
    const y = yPart ? Number(yPart.slice("y=".length)) : undefined;
    viewState.mindmap = {
      parentTaskId: null,
      childOrder: orderPart ? Number(orderPart.slice("order=".length)) || 0 : 0,
      expanded: !parts.includes("collapsed"),
      x: Number.isFinite(x) ? x : undefined,
      y: Number.isFinite(y) ? y : undefined
    };
  }
  return viewState;
}

function encodeReferenceToken(value: string): string {
  return encodeURIComponent(value.trim());
}

function decodeReferenceToken(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}
