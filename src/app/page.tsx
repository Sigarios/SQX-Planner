"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchDigest,
  fmtDateTime,
  fmtDay,
  fmtDayLong,
  fmtTime,
  todayStr,
  type Digest,
} from "@/lib/data";
import { usePlannerData } from "@/lib/session";
import QuickAdd from "@/components/QuickAdd";
import TaskItem from "@/components/TaskItem";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-[14px] font-semibold">{title}</h2>
      <div className="divide-y divide-line border-y border-line">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="py-3 text-[13px] text-mute">Пусто</p>;
}

export default function DigestPage() {
  const load = useCallback((sb: SupabaseClient) => fetchDigest(sb), []);
  const { data } = usePlannerData<Digest>(load);

  if (!data) return null;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-[22px] font-semibold leading-tight">Сегодня</h1>
        <p className="mt-0.5 text-[13px] text-mute">{fmtDayLong(todayStr())}</p>
      </header>

      <QuickAdd />

      <Section title="Встречи">
        {data.meetingsToday.length === 0 ? (
          <Empty />
        ) : (
          data.meetingsToday.map((m) => {
            const time = fmtTime(m.starts_at);
            return (
              <div key={m.id} className="flex items-baseline justify-between py-2.5">
                <span className="text-[15px]">{m.title}</span>
                {time !== "00:00" && (
                  <span className="ml-3 shrink-0 text-[13px] text-mute">{time}</span>
                )}
              </div>
            );
          })
        )}
      </Section>

      <Section title="Задачи">
        {data.overdue.map((t) => (
          <TaskItem key={t.id} task={t} hint={`Просрочено · ${fmtDay(t.due_date ?? "")}`} />
        ))}
        {data.today.map((t) => (
          <TaskItem key={t.id} task={t} compact />
        ))}
        {data.overdue.length + data.today.length === 0 && <Empty />}
      </Section>

      <Section title="Завтра">
        {data.tomorrow.length === 0 ? (
          <Empty />
        ) : (
          data.tomorrow.map((t) => <TaskItem key={t.id} task={t} compact />)
        )}
      </Section>

      <Section title="Заметки">
        {data.notes.length === 0 ? (
          <Empty />
        ) : (
          data.notes.map((n) => (
            <div key={n.id} className="py-2.5">
              <p className="line-clamp-3 whitespace-pre-wrap text-[14px] leading-snug">{n.body}</p>
              <p className="mt-1 text-[12px] text-mute">{fmtDateTime(n.created_at)}</p>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
