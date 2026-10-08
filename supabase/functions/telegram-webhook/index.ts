// Вебхук Telegram-бота: голосовые/аудио/видеозаметки → транскрибация →
// разбор LLM → запись в БД. Обычные текстовые сообщения разбираются так же.

import { corsHeaders, json } from "../_shared/http.ts";
import { downloadTelegramFile, sendMessage } from "../_shared/telegram.ts";
import { parseWithLLM, transcribeAudio } from "../_shared/ai.ts";
import { sanitizeParsed, serviceClient, storeParsed, todayInTz } from "../_shared/ingest.ts";

type TgMessage = {
  from?: { id: number };
  chat: { id: number };
  text?: string;
  voice?: { file_id: string };
  audio?: { file_id: string };
  video_note?: { file_id: string };
};
type TgUpdate = { message?: TgMessage };

async function captureAndStore(
  userId: number,
  chatId: number,
  transcript: string,
  source: string,
) {
  const sb = serviceClient();
  let parsed = null;
  try {
    parsed = sanitizeParsed(await parseWithLLM(transcript, todayInTz()));
  } catch (e) {
    console.error("parse failed:", e);
  }
  if (!parsed) parsed = { type: "note", title: transcript, date: null, time: null };
  const summary = await storeParsed(sb, userId, parsed, transcript, source);
  await sendMessage(chatId, summary);
}

async function handleUpdate(update: TgUpdate) {
  const msg = update.message;
  if (!msg?.from) return;
  const chatId = msg.chat.id;

  if (msg.voice || msg.audio || msg.video_note) {
    const fileId = msg.voice?.file_id ?? msg.audio?.file_id ?? msg.video_note!.file_id;
    await sendMessage(chatId, "Обрабатываю…");
    try {
      const { bytes, mime } = await downloadTelegramFile(fileId);
      const transcript = await transcribeAudio(bytes, mime);
      if (!transcript) throw new Error("пустая расшифровка");
      await captureAndStore(msg.from.id, chatId, transcript, "telegram");
    } catch (e) {
      await sendMessage(chatId, `Не получилось: ${(e as Error).message}`.slice(0, 300));
    }
    return;
  }

  if (msg.text) {
    const t = msg.text.trim();
    if (t.startsWith("/")) {
      await sendMessage(
        chatId,
        "Пришли голосовое, аудио или текст — я разберу и сохраню: задача, встреча или заметка.",
      );
      return;
    }
    await captureAndStore(msg.from.id, chatId, t, "telegram");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // Telegram присылает установленный при setWebhook secret_token в каждом запросе.
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    await handleUpdate((await req.json()) as TgUpdate);
  } catch (e) {
    console.error("webhook error:", e);
  }
  // Telegram ждёт 200, иначе будет ретраить апдейт.
  return json({ ok: true });
});
