import { App, ButtonComponent, DropdownComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { Project, Task, TaskDeleteScope, TaskInput, TaskKind, TaskOccurrence, TaskPriority, TaskRecurrence, TaskStatus, TaskSubtaskInput, TaskUpdateScope } from "../types";
import { addMinutes, parseTimeToMinutes } from "../utils/date";

type TaskModalOptions = {
  title: string;
  projects: Project[];
  initial: TaskInput;
  compositeParents?: Task[];
  existingTask?: Task;
  occurrenceContext?: TaskOccurrence;
  allowSingleDelete?: boolean;
  onSubmit: (input: TaskInput, scope: TaskUpdateScope) => Promise<void>;
  onDelete?: (scope: TaskDeleteScope) => Promise<void>;
  onCompleteSeries?: () => Promise<void>;
  onOpenSeriesEditor?: () => void;
};

export class TaskModal extends Modal {
  private options: TaskModalOptions;

  constructor(app: App, options: TaskModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal", "pm-task-modal");
    contentEl.createEl("h2", { text: this.options.title });

    const state: TaskInput = { ...this.options.initial };
    state.kind = state.kind ?? "simple";
    state.subtasks = [...(state.subtasks ?? [])];
    state.viewState = cloneTaskInputViewState(state.viewState);
    const isOccurrenceEditor = Boolean(this.options.occurrenceContext);

    const form = contentEl.createDiv({ cls: "pm-task-modal-form" });
    const basicSection = createTaskModalSection(form, "基础信息");
    const scheduleSection = createTaskModalSection(form, "时间安排");
    const relationSection = isOccurrenceEditor ? null : createTaskModalSection(form, "归属与状态");
    const recurrenceSection = isOccurrenceEditor ? null : createTaskModalSection(form, "重复规则");
    const subtaskSection = isOccurrenceEditor ? null : createTaskModalSection(form, "组合轻量项");

    if (this.options.occurrenceContext) {
      basicSection.createDiv({
        cls: "pm-muted",
        text: `当前正在编辑 ${this.options.occurrenceContext.occurrenceDate} 这次发生。保存本次只会更新这一条实例，不影响未来；如需修改整条重复任务，请使用下方“编辑整条系列”。`
      });
    } else if (this.options.existingTask?.occurrenceDates.length && this.options.existingTask.occurrenceDates.length > 1) {
      basicSection.createDiv({
        cls: "pm-muted",
        text: "当前编辑的是整条重复任务，下面的日期与重复规则会一起更新全部发生时间。"
      });
    }

    new Setting(basicSection)
      .setName("标题")
      .addText((text) =>
        text
          .setPlaceholder("输入任务标题")
          .setValue(state.title)
          .onChange((value) => {
            state.title = value;
          })
      );

    if (!isOccurrenceEditor) {
      new Setting(basicSection)
        .setName("任务类型")
        .setDesc("组合任务可作为容器，挂载单次、每日或每周子任务")
        .addDropdown((dropdown) => {
          const labels: Record<TaskKind, string> = {
            simple: "普通任务",
            composite: "组合任务"
          };
          (Object.keys(labels) as TaskKind[]).forEach((key) => dropdown.addOption(key, labels[key]));
          dropdown.setValue(state.kind ?? "simple");
          dropdown.onChange((value) => {
            state.kind = value as TaskKind;
            state.subtasks = state.kind === "composite" ? state.subtasks ?? [] : [];
            renderSubtaskFields();
          });
        });
    }

    new Setting(basicSection)
      .setName("描述")
      .addTextArea((text) =>
        text.setValue(state.description ?? "").onChange((value) => {
          state.description = value;
        })
      );

    let dateInput: TextComponent | null = null;
    let startTimeInput: TextComponent | null = null;
    let endTimeInput: TextComponent | null = null;
    const setDateValue = (value: string): void => {
      state.date = value;
      dateInput?.setValue(value);
    };
    const setStartTimeValue = (value?: string): void => {
      state.startTime = value || undefined;
      startTimeInput?.setValue(value ?? "");
    };
    const setEndTimeValue = (value?: string): void => {
      state.endTime = value || undefined;
      endTimeInput?.setValue(value ?? "");
    };

    const scheduleGrid = scheduleSection.createDiv({ cls: "pm-task-field-grid" });
    new Setting(scheduleGrid)
      .setName("日期")
      .addText((text) => {
        dateInput = text;
        text.setPlaceholder("YYYY-MM-DD").setValue(state.date);
        if (isOccurrenceEditor) {
          text.inputEl.disabled = true;
          return text;
        }
        return text.onChange((value) => {
          state.date = value;
        });
      });

    new Setting(scheduleGrid)
      .setName("开始时间")
      .addText((text) => {
        startTimeInput = text;
        return text.setPlaceholder("07:00").setValue(state.startTime ?? "").onChange((value) => {
          state.startTime = value || undefined;
        });
      });

    new Setting(scheduleGrid)
      .setName("结束时间")
      .addText((text) => {
        endTimeInput = text;
        return text.setPlaceholder("07:30").setValue(state.endTime ?? "").onChange((value) => {
          state.endTime = value || undefined;
        });
      });

    let projectDropdown: DropdownComponent | null = null;
    let renderParentField = (): void => undefined;
    let clearParentIfDisallowed = (): void => undefined;
    if (!isOccurrenceEditor && relationSection && recurrenceSection && subtaskSection) {
      const relationGrid = relationSection.createDiv({ cls: "pm-task-field-grid" });
      new Setting(relationGrid)
        .setName("所属项目")
        .addDropdown((dropdown) => {
          projectDropdown = dropdown;
          dropdown.addOption("", "未归属项目");
          this.options.projects.forEach((project) => dropdown.addOption(project.id, project.name));
          dropdown.setValue(state.projectId ?? "");
          dropdown.onChange((value) => {
            state.projectId = value || undefined;
            clearParentIfDisallowed();
            renderParentField();
          });
        });

      const compositeParents = this.options.compositeParents ?? [];
      const parentField = relationSection.createDiv({ cls: "pm-task-parent-field" });
      const getSelectableParents = (): Task[] =>
        compositeParents
          .filter((task) => task.id !== this.options.existingTask?.id)
          .filter((task) => !state.projectId || task.projectId === state.projectId);
      const applyParentSchedule = (parent: Task): void => {
        const nextDate = parent.occurrenceDates.includes(state.date) ? state.date : parent.date;
        setDateValue(nextDate);
        if (!parent.startTime || !parent.endTime) {
          return;
        }
        const parentStart = parseTimeToMinutes(parent.startTime);
        const parentEnd = parseTimeToMinutes(parent.endTime);
        if (parentStart === null || parentEnd === null || parentStart >= parentEnd) {
          return;
        }
        setStartTimeValue(parent.startTime);
        setEndTimeValue(parentEnd - parentStart <= 1 ? parent.endTime : addMinutes(parent.startTime, 1));
      };
      clearParentIfDisallowed = (): void => {
        const currentParentId = state.viewState?.mindmap?.parentTaskId ?? "";
        if (!currentParentId) {
          return;
        }
        if (!getSelectableParents().some((task) => task.id === currentParentId)) {
          state.viewState = withMindmapParent(state.viewState, null);
        }
      };
      renderParentField = (): void => {
        parentField.empty();
        clearParentIfDisallowed();
        const currentParentId = state.viewState?.mindmap?.parentTaskId ?? "";
        const parentOptions = getSelectableParents();
        if (parentOptions.length === 0) {
          parentField.createDiv({
            cls: "pm-muted pm-task-parent-note",
            text: state.projectId ? "当前项目下暂无可挂入的组合任务。" : "暂无可挂入的组合任务。"
          });
          return;
        }
        new Setting(parentField)
          .setName("挂入组合任务")
          .setDesc("选择后，这条任务会作为该组合任务的子任务，并保留自己的重复规则")
          .addDropdown((dropdown) => {
            dropdown.addOption("", "不挂入组合任务");
            parentOptions.forEach((parent) => {
              const projectName = this.options.projects.find((project) => project.id === parent.projectId)?.name ?? "未归属项目";
              dropdown.addOption(parent.id, `${projectName} / ${parent.title}`);
            });
            dropdown.setValue(currentParentId);
            dropdown.onChange((value) => {
              const parentTaskId = value || null;
              state.viewState = withMindmapParent(state.viewState, parentTaskId);
              const parent = parentTaskId ? parentOptions.find((task) => task.id === parentTaskId) : undefined;
              if (parent) {
                state.projectId = parent.projectId;
                projectDropdown?.setValue(parent.projectId ?? "");
                applyParentSchedule(parent);
                renderParentField();
              }
            });
          });
      };
      renderParentField();

      new Setting(relationGrid)
        .setName("状态")
        .addDropdown((dropdown) => {
          const labels: Record<TaskStatus, string> = {
            todo: "待办",
            doing: "进行中",
            blocked: "阻塞",
            done: "已完成"
          };
          (Object.keys(labels) as TaskStatus[]).forEach((key) => dropdown.addOption(key, labels[key]));
          dropdown.setValue(state.status ?? "todo");
          dropdown.onChange((value) => {
            state.status = value as TaskStatus;
          });
        });

      new Setting(relationGrid)
        .setName("优先级")
        .addDropdown((dropdown) => {
          dropdown.addOption("", "无");
          const labels: Record<TaskPriority, string> = {
            low: "低",
            medium: "中",
            high: "高",
            urgent: "紧急"
          };
          (Object.keys(labels) as TaskPriority[]).forEach((key) => dropdown.addOption(key, labels[key]));
          dropdown.setValue(state.priority ?? "");
          dropdown.onChange((value) => {
            state.priority = (value || undefined) as TaskPriority | undefined;
          });
        });

      new Setting(relationSection)
        .setName("标签")
        .setDesc("多个标签用逗号分隔")
        .addText((text) =>
          text.setPlaceholder("例如 parser, ui").setValue((state.tags ?? []).join(", ")).onChange((value) => {
            state.tags = value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
          })
        );

      new Setting(recurrenceSection)
        .setName("重复类型")
        .setDesc("单次、每日重复、每周此时重复")
        .addDropdown((dropdown) => {
          const labels: Array<[TaskRecurrence, string]> = [
            ["once", "单次任务"],
            ["daily", "每日重复"],
            ["weekly", "每周此时重复"]
          ];
          labels.forEach(([key, label]) => dropdown.addOption(key, label));
          dropdown.setValue(state.recurrence);
          dropdown.onChange((value) => {
            state.recurrence = value as TaskRecurrence;
            if (state.recurrence === "once") {
              state.recurrenceCount = null;
              state.recurrenceUntil = null;
            }
            renderRecurrenceFields();
          });
        });
    }

    const recurrenceFields = recurrenceSection?.createDiv({ cls: "pm-task-nested-fields" }) ?? null;
    const subtaskFields = subtaskSection?.createDiv({ cls: "pm-task-nested-fields" }) ?? null;
    const renderRecurrenceFields = (): void => {
      if (!recurrenceFields) {
        return;
      }
      recurrenceFields.empty();
      if (state.recurrence === "once") {
        return;
      }
      new Setting(recurrenceFields)
        .setName("重复次数")
        .setDesc("重复任务至少填写次数或结束日期之一")
        .addText((text) =>
          text.setPlaceholder("例如 10").setValue(state.recurrenceCount ? String(state.recurrenceCount) : "").onChange((value) => {
            state.recurrenceCount = value.trim() ? Number(value) : null;
          })
        );

      new Setting(recurrenceFields)
        .setName("重复结束日期")
        .addText((text) =>
          text.setPlaceholder("YYYY-MM-DD").setValue(state.recurrenceUntil ?? "").onChange((value) => {
            state.recurrenceUntil = value.trim() || null;
          })
        );
    };
    renderRecurrenceFields();

    const renderSubtaskFields = (): void => {
      if (!subtaskFields || !subtaskSection) {
        return;
      }
      subtaskFields.empty();
      if (state.kind !== "composite") {
        subtaskSection.addClass("is-hidden");
        return;
      }
      subtaskSection.removeClass("is-hidden");

      subtaskFields.addClass("pm-subtask-editor");
      subtaskFields.createDiv({
        cls: "pm-muted",
        text: "轻量项可只写标题；如填写时间，必须落在组合任务的开始与结束时间内。需要独立重复规则时，请新建任务并挂入组合任务。"
      });

      const list = subtaskFields.createDiv({ cls: "pm-subtask-editor-list" });
      const subtasks = state.subtasks ?? [];
      subtasks.forEach((subtask, index) => {
        const row = list.createDiv({ cls: "pm-subtask-editor-row" });
        row.createSpan({ cls: "pm-subtask-editor-index", text: `${index + 1}.` });
        const titleInput = row.createEl("input", {
          type: "text",
          placeholder: `子任务 ${index + 1}`
        });
        titleInput.value = subtask.title;
        titleInput.addEventListener("input", () => {
          subtasks[index] = {
            ...subtasks[index],
            title: titleInput.value
          };
          state.subtasks = [...subtasks];
        });
        const startInput = row.createEl("input", {
          type: "text",
          placeholder: "开始"
        });
        startInput.value = subtask.startTime ?? "";
        startInput.addEventListener("input", () => {
          subtasks[index] = {
            ...subtasks[index],
            startTime: startInput.value.trim() || undefined
          };
          state.subtasks = [...subtasks];
        });
        const endInput = row.createEl("input", {
          type: "text",
          placeholder: "结束"
        });
        endInput.value = subtask.endTime ?? "";
        endInput.addEventListener("input", () => {
          subtasks[index] = {
            ...subtasks[index],
            endTime: endInput.value.trim() || undefined
          };
          state.subtasks = [...subtasks];
        });
        row.createEl("button", { text: "删除", cls: "mod-warning" }).addEventListener("click", () => {
          subtasks.splice(index, 1);
          state.subtasks = [...subtasks];
          renderSubtaskFields();
        });
      });

      const actions = subtaskFields.createDiv({ cls: "pm-inline-actions" });
      actions.createEl("button", { text: "新增轻量检查项" }).addEventListener("click", () => {
        state.subtasks = [...(state.subtasks ?? []), { title: "" } satisfies TaskSubtaskInput];
        renderSubtaskFields();
      });
    };
    renderSubtaskFields();

    const footer = contentEl.createDiv({ cls: "pm-modal-actions" });
    new ButtonComponent(footer)
      .setButtonText(isOccurrenceEditor ? "保存本次" : "保存")
      .setCta()
      .onClick(async () => {
        try {
          await this.options.onSubmit(state, isOccurrenceEditor ? "occurrence" : "series");
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "保存失败");
        }
      });

    if (isOccurrenceEditor && this.options.onOpenSeriesEditor) {
      new ButtonComponent(footer)
        .setButtonText("编辑整条系列")
        .onClick(() => {
          this.close();
          this.options.onOpenSeriesEditor?.();
        });
    }

    if (this.options.onDelete) {
      if (this.options.allowSingleDelete) {
        new ButtonComponent(footer)
          .setButtonText("删除本次实例")
          .setWarning()
          .onClick(async () => {
            await this.options.onDelete?.("single");
            this.close();
          });
      }

      if (this.options.existingTask?.occurrenceDates.length && this.options.existingTask.occurrenceDates.length > 1) {
        new ButtonComponent(footer)
          .setButtonText("删除整个系列")
          .setWarning()
          .onClick(async () => {
            await this.options.onDelete?.("series");
            this.close();
          });
      }
    }

    if (this.options.onCompleteSeries && this.options.existingTask?.occurrenceDates.length && this.options.existingTask.occurrenceDates.length > 1) {
      new ButtonComponent(footer)
        .setButtonText("到本次为止结束重复")
        .onClick(async () => {
          await this.options.onCompleteSeries?.();
          this.close();
        });
    }
  }
}

function cloneTaskInputViewState(viewState: TaskInput["viewState"]): TaskInput["viewState"] {
  if (!viewState) {
    return undefined;
  }
  return {
    board: viewState.board ? { ...viewState.board } : undefined,
    gantt: viewState.gantt ? { ...viewState.gantt, dependencyIds: [...(viewState.gantt.dependencyIds ?? [])] } : undefined,
    mindmap: viewState.mindmap ? { ...viewState.mindmap } : undefined
  };
}

function createTaskModalSection(container: HTMLElement, title: string): HTMLElement {
  const section = container.createDiv({ cls: "pm-task-modal-section" });
  section.createEl("h3", { text: title });
  return section;
}

function withMindmapParent(viewState: TaskInput["viewState"], parentTaskId: string | null): TaskInput["viewState"] {
  return {
    ...(viewState ?? {}),
    mindmap: {
      ...(viewState?.mindmap ?? {}),
      parentTaskId,
      childOrder: viewState?.mindmap?.childOrder ?? Date.now(),
      expanded: viewState?.mindmap?.expanded ?? true
    }
  };
}
