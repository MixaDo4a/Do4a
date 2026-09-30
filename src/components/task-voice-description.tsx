"use client";

import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_RECORDING_SECONDS = 90;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

type Props = {
  initialValue?: string;
};

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export function TaskVoiceDescription({ initialValue = "" }: Props) {
  const [description, setDescription] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [transcriptionMs, setTranscriptionMs] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "recording") return;
    const interval = setInterval(() => {
      setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000)));
    }, 250);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function transcribe(blob: Blob, mimeType: string) {
    if (blob.size === 0) {
      setMessage("Запись пустая. Попробуйте ещё раз.");
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      setMessage("Запись получилась слишком большой. Сделайте её короче.");
      return;
    }

    const formData = new FormData();
    formData.append("audio", blob, `task-voice.${extensionForMimeType(mimeType)}`);
    const startedAt = Date.now();
    setStatus("transcribing");
    setMessage("");
    setTranscriptionMs(null);

    try {
      const response = await fetch("/api/tasks/transcribe", { method: "POST", body: formData });
      const result = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok || !result?.text?.trim()) {
        throw new Error(result?.error || "Не удалось распознать запись.");
      }

      const transcript = result.text.trim();
      setDescription((current) => `${current.trimEnd()}${current.trim() ? "\n" : ""}${transcript}`);
      setTranscriptionMs(Date.now() - startedAt);
      setMessage("Текст распознан и добавлен в описание.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось распознать запись.");
    } finally {
      setStatus("idle");
    }
  }

  async function startRecording() {
    setMessage("");
    setTranscriptionMs(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("Запись аудио не поддерживается этим браузером.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const supportedTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const actualMimeType = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const recording = new Blob(chunksRef.current, { type: actualMimeType });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStatus("idle");
        void transcribe(recording, actualMimeType);
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setSeconds(0);
      setStatus("recording");
      stopTimerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_RECORDING_SECONDS * 1000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setMessage("Не удалось получить доступ к микрофону.");
    }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return (
    <div className="grid gap-2">
      <textarea
        className="min-h-20 rounded-md border border-line px-3 py-2 outline-none focus:border-brand"
        name="description"
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Описание"
        value={description}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium transition hover:border-brand/60 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === "transcribing"}
          onClick={status === "recording" ? stopRecording : startRecording}
          type="button"
        >
          {status === "recording" ? <Square size={16} /> : status === "transcribing" ? <LoaderCircle className="animate-spin" size={16} /> : <Mic size={16} />}
          {status === "recording" ? `Остановить · ${seconds} сек` : status === "transcribing" ? "Распознаю…" : "Записать голосом"}
        </button>
        {transcriptionMs !== null ? <span className="text-xs text-muted">Обработка: {(transcriptionMs / 1000).toFixed(1)} сек</span> : null}
      </div>
      {message ? <p aria-live="polite" className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
