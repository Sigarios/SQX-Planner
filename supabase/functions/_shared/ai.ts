// Транскрибация аудио и семантический разбор текста.
//
// ВАЖНО: OpenRouter предоставляет только текстовые (chat) модели и НЕ принимает
// аудио. Поэтому пайплайн двухступенчатый:
//   1. Аудио → Groq API (whisper-large-v3, есть бесплатный тариф).
//   2. Текст → OpenRouter (любая чат-модель) → структурированный JSON.

export type Parsed = {
  type: "task" | "meeting" | "note";
  title: string;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
};

export async function transcribeAudio(bytes: Uint8Array, mime: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), "audio.ogg");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`groq: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export async function parseWithLLM(text: string, today: string): Promise<unknown> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const model = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";

  const system = `Ты — парсер заметок личного планера. Сегодня ${today}.
Верни СТРОГО один JSON-объект без пояснений:
{"type":"task"|"meeting"|"note","title":"строка","date":null|"YYYY-MM-DD","time":null|"HH:MM"}
Правила:
- Обещание что-то сделать («позвонить», «купить», «отправить отчёт») — type "task"; title — короткая формулировка задачи.
- Встреча, созвон, событие, привязанное ко времени — type "meeting"; title — название; time — "HH:MM", если время упомянуто.
- Мысль, идея, наблюдение без действия — type "note"; в title положи текст как есть.
- date/time вычисляй относительно сегодняшней даты ${today}. Если в тексте нет явного указания — ставь null, не выдумывай.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "personal-planner",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openrouter: ${res.status} ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = (data.choices?.[0]?.message?.content ?? "")
    .replace(/```(?:json)?|```/g, "")
    .trim();
  return JSON.parse(raw);
}
