// Сохранение разобранной записи в БД (из-под service role — RLS обходится
// осознанно: user_id берётся из проверенного источника, а не из запроса).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Parsed } from "./ai.ts";

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Сегодняшняя дата (YYYY-MM-DD) в таймзоне пользователя. */
export function todayInTz(): string {
  const tz = Deno.env.get("APP_TZ") ?? "Europe/Moscow";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Приводит ответ LLM к валидной записи; встреча без даты деградирует в заметку. */
export function sanitizeParsed(raw: unknown): Parsed | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== "task" && type !== "meeting" && type !== "note") return null;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const date = typeof o.date === "string" && DATE_RE.test(o.date) ? o.date : null;
  const time = typeof o.time === "string" && TIME_RE.test(o.time) ? o.time : null;
  if (type === "meeting" && !date) return { type: "note", title, date: null, time: null };
  return { type, title, date, time };
}

/** Пишет запись в нужную таблицу + журнал captures. Возвращает человекочитаемый итог. */
export async function storeParsed(
  sb: SupabaseClient,
  userId: number,
  parsed: Parsed,
  transcript: string,
  source: string,
): Promise<string> {
  let summary: string;

  if (parsed.type === "task") {
    const { error } = await sb.from("tasks").insert({
      user_id: userId,
      title: parsed.title,
      due_date: parsed.date,
      source,
    });
    if (error) throw error;
    summary = parsed.date
      ? `Задача «${parsed.title}» — на ${parsed.date}`
      : `Задача «${parsed.title}» — без даты`;
  } else if (parsed.type === "meeting") {
    const startsAt = `${parsed.date}T${parsed.time ?? "00:00"}:00`;
    const { error } = await sb.from("meetings").insert({
      user_id: userId,
      title: parsed.title,
      starts_at: startsAt,
      source,
    });
    if (error) throw error;
    summary = `Встреча «${parsed.title}» — ${parsed.date}${parsed.time ? ` ${parsed.time}` : ""}`;
  } else {
    const { error } = await sb.from("notes").insert({
      user_id: userId,
      body: parsed.title,
      source,
    });
    if (error) throw error;
    const short = parsed.title.length > 60 ? `${parsed.title.slice(0, 60)}…` : parsed.title;
    summary = `Заметка: «${short}»`;
  }

  await sb.from("captures").insert({ user_id: userId, transcript, parsed, source });
  return summary;
}
