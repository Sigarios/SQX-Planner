// Запросы к Supabase и утилиты дат. Все даты — локальные строки YYYY-MM-DD,
// у встреч — «наивное» локальное время, как и в БД.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, Note, Task } from "./types";

async function one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- Утилиты дат ----------

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function addDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-10-07" → "7 окт" */
export function fmtDay(s: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })
    .format(new Date(`${s}T00:00:00`))
    .replace(".", "");
}

/** "2026-10-07" → "Вторник, 7 октября" */
export function fmtDayLong(s: string): string {
  return capFirst(
    new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" })
      .format(new Date(`${s}T00:00:00`)),
  );
}

/** ISO-строка времени → "14:30" */
export function fmtTime(startsAt: string): string {
  return startsAt.slice(11, 16);
}

/** created_at → "7 окт, 14:32" */
export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(".", "");
}

/** Сетка месяца, недели с понедельника; null — день соседнего месяца. */
export function monthMatrix(year: number, month0: number): (string | null)[][] {
  const offset = (new Date(year, month0, 1).getDay() + 6) % 7;
  const cursor = new Date(year, month0, 1 - offset);
  const weeks: (string | null)[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(cursor.getMonth() === month0 ? dateStr(cursor) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks.filter((row) => row.some(Boolean));
}

// ---------- Запросы ----------

export type Digest = {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  meetingsToday: Meeting[];
  notes: Note[];
};

export async function fetchDigest(sb: SupabaseClient): Promise<Digest> {
  const today = todayStr();
  const [overdue, tod, tom, meet, notes] = await Promise.all([
    one<Task[]>(
      sb.from("tasks").select("*").eq("done", false).lt("due_date", today).order("due_date"),
    ),
    one<Task[]>(
      sb.from("tasks").select("*").eq("done", false).eq("due_date", today).order("created_at"),
    ),
    one<Task[]>(
      sb.from("tasks").select("*").eq("done", false).eq("due_date", addDaysStr(1)).order("created_at"),
    ),
    one<Meeting[]>(
      sb.from("meetings")
        .select("*")
        .gte("starts_at", `${today}T00:00:00`)
        .lte("starts_at", `${today}T23:59:59`)
        .order("starts_at"),
    ),
    one<Note[]>(
      sb.from("notes").select("*").order("created_at", { ascending: false }).limit(3),
    ),
  ]);
  return { overdue, today: tod, tomorrow: tom, meetingsToday: meet, notes };
}

export type MonthData = { meetings: Meeting[]; tasks: Task[] };

export async function fetchMonth(
  sb: SupabaseClient,
  year: number,
  month0: number,
): Promise<MonthData> {
  const first = dateStr(new Date(year, month0, 1));
  const last = dateStr(new Date(year, month0 + 1, 0));
  const [meetings, tasks] = await Promise.all([
    one<Meeting[]>(
      sb.from("meetings")
        .select("*")
        .gte("starts_at", `${first}T00:00:00`)
        .lte("starts_at", `${last}T23:59:59`)
        .order("starts_at"),
    ),
    one<Task[]>(
      sb.from("tasks").select("*").gte("due_date", first).lte("due_date", last).order("due_date"),
    ),
  ]);
  return { meetings, tasks };
}

export async function fetchNotes(sb: SupabaseClient): Promise<Note[]> {
  return one<Note[]>(
    sb.from("notes").select("*").order("created_at", { ascending: false }).limit(50),
  );
}
