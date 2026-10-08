"use client";

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNotes, fmtDateTime } from "@/lib/data";
import { usePlannerData, useSession } from "@/lib/session";
import { emitRefresh } from "@/lib/session";
import { hapticTap } from "@/lib/telegram";
import type { Note } from "@/lib/types";

export default function NotesPage() {
  const { sb } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback((c: SupabaseClient) => fetchNotes(c), []);
  const { data } = usePlannerData<Note[]>(load);

  async function save() {
    const value = body.trim();
    if (!value || !sb || busy) return;
    setBusy(true);
    hapticTap();
    try {
      await sb.from("notes").insert({ body: value });
      setBody("");
      emitRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 mt-1 text-[18px] font-semibold">Заметки</h1>

      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Быстрая мысль…"
          rows={2}
          className="min-w-0 flex-1 resize-none border border-line bg-surface p-3 text-[14px] placeholder:text-mute focus:border-ink"
        />
        <button
          onClick={save}
          className="h-9 self-start bg-ink px-4 text-[13px] font-medium text-white"
        >
          Сохранить
        </button>
      </div>

      <div className="mt-5 divide-y divide-line border-y border-line">
        {!data || data.length === 0 ? (
          <p className="py-3 text-[13px] text-mute">Пусто</p>
        ) : (
          data.map((n) => (
            <div key={n.id} className="py-2.5">
              <p className="whitespace-pre-wrap text-[14px] leading-snug">{n.body}</p>
              <p className="mt-1 text-[12px] text-mute">{fmtDateTime(n.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
