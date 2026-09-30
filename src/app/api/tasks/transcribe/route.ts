import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, TASK_CREATOR_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function apiErrorMessage(body: unknown) {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: { message?: unknown } | string }).error;
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
  }
  return "Сервис распознавания временно недоступен.";
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUDIO_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Запись слишком большая. Сделайте её короче." }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Войдите в приложение, чтобы использовать запись." }, { status: 401 });

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, TASK_CREATOR_ROLES)) {
    return NextResponse.json({ error: "Нет прав на создание задач." }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Распознавание речи пока не настроено на сервере." }, { status: 503 });
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать аудиозапись." }, { status: 400 });
  }

  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Аудиозапись не найдена." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Запись слишком большая. Сделайте её короче." }, { status: 413 });
  }

  const extension = audio.name.split(".").pop()?.toLowerCase();
  const supportedExtensions = new Set(["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac"]);
  if (!extension || !supportedExtensions.has(extension)) {
    return NextResponse.json({ error: "Формат записи не поддерживается. Обновите браузер и попробуйте снова." }, { status: 415 });
  }

  const openAiForm = new FormData();
  openAiForm.append("model", "gpt-transcribe");
  openAiForm.append("languages[]", "ru");
  openAiForm.append("file", audio, audio.name);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openAiForm,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: apiErrorMessage(body) }, { status: response.status === 429 ? 429 : 502 });
    }

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "В записи не удалось распознать речь." }, { status: 422 });
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Распознавание заняло слишком много времени. Попробуйте запись покороче."
      : "Не удалось связаться с сервисом распознавания. Попробуйте ещё раз.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
