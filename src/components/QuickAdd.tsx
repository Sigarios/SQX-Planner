"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";
import { emitRefresh } from "@/lib/session";
import { addDaysStr, todayStr } from "@/lib/data";
import { hapticTap } from "@/lib/telegram";

type Mode = "task" | "note";
type When = "none" | "today" | "tomorrow";

const chip = (active: boolean) =>
  `h-7 border px-2.5 text-[13px] ${
    active ? "border-ink bg-surface text-ink" : "border-line text-mute"
  }`;

export default function QuickAdd() {
  const { sb } = useSession();
  const [mode, setMode] = useState<Mode>("task");
  const [when, setWhen] = useState<When>("none");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const value = text.trim();
    if (!value || !sb || busy) return;
    setBusy(true);
    hapticTap();
    try {
      if (mode === "task") {
        const due = when === "today" ? todayStr() : when === "tomorrow" ? addDaysStr(1) : null;
        await sb.from("tasks").insert({ title: value, due_date: due });
      } else {
        await sb.from("notes").insert({ body: value });
      }
      setText("");
      emitRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2">
      <div className="mb-2 flex gap-1">
        <button className={chip(mode === "task")} onClick={() => setMode("task")}>
          Задача
        </button>
        <button className={chip(mode === "note")} onClick={() => setMode("note")}>
          Заметка
        </button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "task" ? "Новая задача" : "Новая заметка"}
          className="h-9 min-w-0 flex-1 border border-line bg-surface px-3 text-[14px] placeholder:text-mute focus:border-ink"
        />
        <button type="submit" className="h-9 bg-ink px-4 text-[13px] font-medium text-white">
          Добавить
        </button>
      </form>

      {mode === "task" && (
        <div className="mt-2 flex gap-1">
          <button className={chip(when === "today")} onClick={() => setWhen("today")}>
            Сегодня
          </button>
          <button className={chip(when === "tomorrow")} onClick={() => setWhen("tomorrow")}>
            Завтра
          </button>
          <button className={chip(when === "none")} onClick={() => setWhen("none")}>
            Без даты
          </button>
        </div>
      )}
    </div>
  );
}
