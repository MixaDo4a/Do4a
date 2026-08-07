export type RoutinePhotoAiReview = {
  approved: boolean;
  summary: string;
  issues: string[];
};

type ReviewArgs = {
  employeePhoto: {
    bytes: ArrayBuffer;
    mimeType: string | null;
  };
  templatePhoto: {
    bytes: ArrayBuffer;
    mimeType: string | null;
  };
  routineTitle: string;
  itemTitle: string;
  storeLabel: string;
};

function toDataUrl(bytes: ArrayBuffer, mimeType: string | null) {
  const effectiveMimeType = mimeType || "image/jpeg";
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${effectiveMimeType};base64,${base64}`;
}

function parseJsonResponse(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;

  return JSON.parse(fenced) as Partial<RoutinePhotoAiReview>;
}

function countLatinLetters(value: string) {
  return (value.match(/[A-Za-z]/g) ?? []).length;
}

function countCyrillicLetters(value: string) {
  return (value.match(/[А-Яа-яЁё]/g) ?? []).length;
}

function normalizeReviewText(value: string | null | undefined, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;

  const latin = countLatinLetters(text);
  const cyrillic = countCyrillicLetters(text);
  const tooEnglish = latin > 4 && cyrillic < Math.max(2, Math.ceil(latin * 0.25));

  if (tooEnglish) {
    return fallback;
  }

  return text;
}

export async function reviewRoutinePhotoWithOpenAI({
  employeePhoto,
  templatePhoto,
  routineTitle,
  itemTitle,
  storeLabel,
}: ReviewArgs): Promise<RoutinePhotoAiReview> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      approved: false,
      summary: "Ключ OpenAI не настроен на сервере. Требуется ручная проверка.",
      issues: ["OPENAI_API_KEY не настроен на сервере."],
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 140,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Ты проверяешь фотографию выполнения пункта распорядка дня сотрудником розничного магазина.",
            "Сравни фото сотрудника только с фото-шаблоном и оцени именно визуальное соответствие.",
            "Не используй общие рассуждения и не придумывай лишние детали.",
            "Если фото сотрудника соответствует фото-шаблону и требованиям пункта, верни approved=true.",
            "Если есть несоответствия, верни approved=false и перечисли только конкретные визуальные отличия.",
            "Ответ верни только в JSON с ключами approved (boolean), summary (string), issues (array of strings).",
            "Все summary и issues пиши только на русском языке.",
            "Не используй английские слова и не упоминай политику, инструкцию, JSON-схему или внутренние правила.",
            "Если фото похоже на шаблон, но не подходит по требованиям пункта, укажи именно эти причины.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Распорядок: ${routineTitle}`,
                `Пункт: ${itemTitle}`,
                `Магазин: ${storeLabel}`,
                "Фотография-шаблон — это эталон для сравнения.",
                "Фотография сотрудника — это загруженное фото выполнения пункта.",
                "Проверяй наличие человека, форму, бейдж, опрятность, позу и общий вид.",
                "Если эталон и фото сотрудника совпадают по содержанию пункта, верни approved=true.",
                "Если есть сомнения, верни approved=false и перечисли только фактические отличия между эталоном и фото сотрудника.",
                "Ответ только JSON.",
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: toDataUrl(templatePhoto.bytes, templatePhoto.mimeType),
              },
            },
            {
              type: "image_url",
              image_url: {
                url: toDataUrl(employeePhoto.bytes, employeePhoto.mimeType),
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Проверка OpenAI не удалась: ${response.status} ${detail}`.trim());
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = parseJsonResponse(content);
    const approved = Boolean(parsed.approved);
    const summary = normalizeReviewText(parsed.summary, approved ? "Фото соответствует требованиям пункта." : "Фото требует внимания.");
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((issue) => normalizeReviewText(issue, "Требуется ручная проверка."))
          .filter(Boolean)
      : [];

    return {
      approved,
      summary,
      issues,
    };
  } catch {
    return {
      approved: false,
      summary: "Не удалось разобрать ответ OpenAI.",
      issues: [content.slice(0, 500) || "Пустой ответ"],
    };
  }
}
