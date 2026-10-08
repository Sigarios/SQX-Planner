// capture-ingest — приёмник для iPhone Shortcuts (Action Button).
// Авторизация: заголовок "Authorization: Bearer <CAPTURE_SECRET>" (личный токен).
// Принимает POST:
//   - multipart/form-data с полем "text" (диктовка) или "file"/"audio" (запись),
//   - либо raw-тело с Content-Type audio/*.
// Возвращает короткий текст-итог — его Shortcut показывает в уведомлении.

import { corsHeaders } from "../_shared/http.ts";
import { parseWithLLM, transcribeAudio } from "../_shared/ai.ts";
import { sanitizeParsed, serviceClient, storeParsed, todayInTz } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("CAPTURE_SECRET");
  const userId = Number(Deno.env.get("CAPTURE_USER_ID"));
  if (!secret || !userId) {
    return new Response(
      "capture is not configured: set CAPTURE_SECRET and CAPTURE_USER_ID secrets",
      { status: 500, headers: corsHeaders },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const ct = req.headers.get("content-type") ?? "";
    let text: string | null = null;
    let bytes: Uint8Array | null = null;
    let mime = "audio/ogg";
    let source = "shortcut";

    if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const t = form.get("text");
      if (typeof t === "string" && t.trim()) text = t.trim();
      const f = form.get("file") ?? form.get("audio");
      if (f && typeof f === "object" && "arrayBuffer" in f) {
        const file = f as File;
        bytes = new Uint8Array(await file.arrayBuffer());
        if (file.type) mime = file.type;
      }
      const s = form.get("source");
      if (typeof s === "string" && s.trim()) source = s.trim();
    } else if (ct.startsWith("audio/") || ct === "application/octet-stream") {
      bytes = new Uint8Array(await req.arrayBuffer());
      mime = ct;
    }

    if (!text && (!bytes || bytes.length === 0)) {
      return new Response("no text or audio in request", { status: 400, headers: corsHeaders });
    }

    const transcript = text ?? (await transcribeAudio(bytes!, mime));
    if (!transcript) {
      return new Response("empty transcript", { status: 400, headers: corsHeaders });
    }

    const sb = serviceClient();
    let parsed = null;
    try {
      parsed = sanitizeParsed(await parseWithLLM(transcript, todayInTz()));
    } catch (e) {
      console.error("parse failed:", e);
    }
    if (!parsed) parsed = { type: "note", title: transcript, date: null, time: null };

    const summary = await storeParsed(sb, userId, parsed, transcript, source);
    return new Response(summary, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders },
    });
  } catch (e) {
    console.error("capture-ingest error:", e);
    return new Response(`error: ${(e as Error).message}`.slice(0, 300), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
