"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  return (
    <button
      aria-label="Назад"
      className="inline-flex h-11 w-11 items-center justify-center rounded-[18px] border border-line bg-surface text-ink shadow-soft transition active:scale-95"
      onClick={() => router.back()}
      type="button"
    >
      <ArrowLeft size={18} />
    </button>
  );
}

