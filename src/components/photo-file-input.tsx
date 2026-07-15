"use client";

import { Camera, CheckCircle2 } from "lucide-react";
import { useState } from "react";

type PhotoFileInputProps = {
  name: string;
  label?: string;
  selectedLabel?: string;
  required?: boolean;
};

export function PhotoFileInput({
  name,
  label = "Добавить фото Z-отчета",
  selectedLabel = "Фото добавлено",
  required = true,
}: PhotoFileInputProps) {
  const [hasFile, setHasFile] = useState(false);

  return (
    <label className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold">
      {hasFile ? <CheckCircle2 size={18} /> : <Camera size={18} />}
      {hasFile ? selectedLabel : label}
      <input
        accept="image/*"
        capture="environment"
        className="sr-only"
        name={name}
        onChange={(event) => setHasFile(Boolean(event.currentTarget.files?.length))}
        required={required}
        type="file"
      />
    </label>
  );
}

