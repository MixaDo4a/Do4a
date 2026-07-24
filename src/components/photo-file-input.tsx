"use client";

import { Camera, CheckCircle2 } from "lucide-react";
import { useId, useState } from "react";

type PhotoFileInputProps = {
  name: string;
  label?: string;
  selectedLabel?: string;
  required?: boolean;
};

const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.82;
const COMPRESSION_THRESHOLD_BYTES = 2_500_000;

function formatFileSize(size: number) {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)} МБ`;
  if (size >= 1_000) return `${Math.round(size / 1_000)} КБ`;
  return `${size} Б`;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image was not loaded"));
    };
    image.src = url;
  });
}

async function compressImageFile(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") {
    return file;
  }

  if (file.size <= COMPRESSION_THRESHOLD_BYTES) {
    return file;
  }

  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const fileName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${fileName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function PhotoFileInput({
  name,
  label = "Добавить фото Z-отчета",
  selectedLabel = "Фото добавлено",
  required = false,
}: PhotoFileInputProps) {
  const [hasFile, setHasFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const inputId = useId();

  return (
    <label
      className="group relative mt-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-black/30 px-4 py-3 text-sm font-semibold transition hover:border-brand/70 hover:shadow-[0_0_22px_rgba(225,15,35,0.22)]"
      htmlFor={inputId}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-black/35 text-brand transition group-hover:border-brand/70">
        {hasFile ? <CheckCircle2 size={18} /> : <Camera size={18} />}
      </span>
      <span className="min-w-0">
        <span className="block">{isProcessing ? "Подготавливаем фото..." : hasFile ? selectedLabel : label}</span>
        {fileName ? <span className="mt-0.5 block truncate text-xs font-normal text-muted">{fileName}</span> : null}
      </span>
      <input
        accept="image/*"
        className="sr-only"
        id={inputId}
        name={name}
        onChange={async (event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;

          if (!file) {
            setHasFile(false);
            setFileName("");
            return;
          }

          setIsProcessing(true);
          const preparedFile = await compressImageFile(file);
          let displayedFile = preparedFile;

          if (preparedFile !== file) {
            try {
              const transfer = new DataTransfer();
              transfer.items.add(preparedFile);
              input.files = transfer.files;
            } catch {
              displayedFile = file;
            }
          }

          setHasFile(true);
          setFileName(`${displayedFile.name} · ${formatFileSize(displayedFile.size)}`);
          setIsProcessing(false);
        }}
        required={required}
        type="file"
      />
    </label>
  );
}

