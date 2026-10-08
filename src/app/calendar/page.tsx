"use client";

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  capFirst,
  fetchMonth,
  fmtDayLong,
  fmtTime,
  monthMatrix,
  todayStr,
  WEEKDAYS,
  type MonthData,
} from "@/lib/data";
import { usePlannerData, useSession } from "@/lib/session";
import { emitRefresh } from "@/lib/session";
import TaskItem from "@/components/TaskItem";
import { hapticTap } from "@/lib/telegram";

const inputCls = "h-9 border border-line bg-surface px-3 text-[14px] placeholder:text-mute focus:border-ink";
const btnCls = "h-9 bg-ink px-4 text-[13px] font-medium text-white";

export default function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(todayStr());
  const [mTitle, setMTitle] = useState("");
  const [mTime, setMTime] = useState("09:00");
  const [tTitle, setTTitle] = useState("");
  const { sb } = useSession();

  const load = useCallback(
    (c: SupabaseClient) => fetchMonth(c, cursor.y, cursor.m),
    [cursor.y, cursor.m],
  );
  const { data } = usePlannerData<MonthData>(load);

  const weeks = monthMatrix(cursor.y, cursor.m);
  const dots = new Set<string>();
  data?.meetings.forEach((m) => dots.add(m.starts_at.slice(0, 10)));
  data?.tasks.forEach((t) => {
    if (t.due_date) dots.add(t.due_date);
  });

  const dayMeetings = (data?.meetings ?? [])
    .filter((m) => m.starts_at.slice(0, 10) === selected)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const dayTasks = (data?.tasks ?? []).filter((t) => t.due_date === selected);

  function shift(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  async function addMeeting() {
    if (!sb || !mTitle.trim()) return;
    hapticTap();
    await sb.from("meetings").insert({
      title: mTitle.trim(),
      starts_at: `${selected}T${mTime || "09:00"}:00`,
    });
    setMTitle("");
    emitRefresh();
  }

  async function addTask() {
    if (!sb || !tTitle.trim()) return;
    hapticTap();
    await sb.from("tasks").insert({ title: tTitle.trim(), due_date: selected });
    setTTitle("");
    emitRefresh();
  }

  const monthTitle = capFirst(
    new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
      .format(new Date(cursor.y, cursor.m, 1))
      .replace(" г.", ""),
  );

  return (
    <div>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-[18px] font-semibold">{monthTitle}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => shift(-1)}
            aria-label="Предыдущий месяц"
            className="h-8 w-8 border border-line text-[16px] leading-none"
          >
            ‹
          </button>
          <button
            onClick={() => shift(1)}
            aria-label="Следующий месяц"
            className="h-8 w-8 border border-line text-[16px] leading-none"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[12px] text-mute">
            {w}
          </div>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <div key={i} />;
          const inMonth = Number(d.slice(5, 7)) - 1 === cursor.m;
          const isSelected = d === selected;
          const isToday = d === todayStr();
          return (
            <button
              key={d}
              onClick={() => setSelected(d)}
              className={`relative mx-auto flex h-9 w-9 items-center justify-center text-[14px] ${
                isSelected
                  ? "bg-ink text-white"
                  : isToday
                    ? "border border-ink"
                    : inMonth
                      ? ""
                      : "text-mute/50"
              }`}
            >
              {Number(d.slice(8, 10))}
              {dots.has(d) && (
                <span
                  className={`absolute bottom-0.5 h-[3px] w-[3px] rounded-full ${
                    isSelected ? "bg-white" : "bg-ink"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <h2 className="text-[14px] font-semibold">{capFirst(fmtDayLong(selected))}</h2>
        <div className="mt-1 divide-y divide-line border-y border-line">
          {dayMeetings.map((m) => {
            const time = fmtTime(m.starts_at);
            return (
              <div key={m.id} className="flex items-baseline justify-between py-2.5">
                <span className="text-[15px]">{m.title}</span>
                {time !== "00:00" && (
                  <span className="ml-3 shrink-0 text-[13px] text-mute">{time}</span>
                )}
              </div>
            );
          })}
          {dayTasks.map((t) => (
            <TaskItem key={t.id} task={t} compact />
          ))}
          {dayMeetings.length + dayTasks.length === 0 && (
            <p className="py-3 text-[13px] text-mute">Пусто</p>
          )}
        </div>
      </div>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          addMeeting();
        }}
      >
        <p className="mb-1.5 text-[13px] text-mute">Встреча</p>
        <div className="flex gap-2">
          <input
            value={mTitle}
            onChange={(e) => setMTitle(e.target.value)}
            placeholder="Название"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <input
            type="time"
            value={mTime}
            onChange={(e) => setMTime(e.target.value)}
            className={`${inputCls} w-24 px-2`}
          />
          <button type="submit" className={btnCls}>
            Добавить
          </button>
        </div>
      </form>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          addTask();
        }}
      >
        <p className="mb-1.5 text-[13px] text-mute">Задача</p>
        <div className="flex gap-2">
          <input
            value={tTitle}
            onChange={(e) => setTTitle(e.target.value)}
            placeholder="Название"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button type="submit" className={btnCls}>
            Добавить
          </button>
        </div>
      </form>
    </div>
  );
}
