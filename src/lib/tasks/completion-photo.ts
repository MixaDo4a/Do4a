export const MAX_COMPLETION_PHOTO_BYTES = 4 * 1024 * 1024;
export const COMPLETION_PHOTO_RETENTION_DAYS = 6;

const signatures: Array<{ mime: string; extension: string; matches: (bytes: Uint8Array) => boolean }> = [
  { mime: "image/jpeg", extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", extension: "png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: "image/webp", extension: "webp", matches: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
];

export function getCompletionPhotoType(file: File) {
  if (file.size <= 0 || file.size > MAX_COMPLETION_PHOTO_BYTES) return null;
  const type = signatures.find((item) => item.mime === file.type);
  if (!type) return null;
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    return type.matches(bytes) ? type : null;
  });
}
