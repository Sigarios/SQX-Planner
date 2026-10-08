"use client";

import type { Task } from "@/lib/types";
import { fmtDay } from "@/lib/data";
import { useSession } from "@/lib/session";
import { emitRefresh } from "@/lib/session";
import { hapticTap } from "@/lib/telegram";

export default function TaskItem({
  task,
  hint,
  compact = false,
}: {
  task: Task;
  /** Замена даты: например «Просрочено · 5 окт». */
  hint?: string;
  /** Не показывать дату вообще (когда она и так видна из контекста). */
  compact?: boolean;
}) {
  const { sb } = useSession();

  async function toggle() {
    if (!sb) return;
    hapticTap();
    const done = !task.done;
    await sb
      .from("tasks")
      .update({ done, completed_at: done ? new Date().toISOString() : null })
      .eq("id", task.id);
    emitRefresh();
  }

  const secondary = hint ?? (compact || !task.due_date ? null : fmtDay(task.due_date));

  return (
    <div className="flex items-start gap-3 py-2.5">
      <button
        aria-label={task.done ? "Вернуть задачу" : "Выполнено"}
        onClick={toggle}
        className={`mt-0.5 h-4 w-4 shrink-0 border border-ink ${
          task.done ? "bg-ink" : "bg-transparent"
        }`}
      />
      <div className="min-w-0">
        <p className={`text-[15px] leading-snug ${task.done ? "text-mute line-through" : ""}`}>
          {task.title}
        </p>
        {secondary && <p className="mt-0.5 text-[12px] text-mute">{secondary}</p>}
      </div>
    </div>
  );
}
