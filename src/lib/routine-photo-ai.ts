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
      max_tokens: 160,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Ты проверяешь фото выполнения пункта распорядка дня для сотрудника розничного магазина.",
            "Сравни фото сотрудника с фото-эталоном, а не с общими представлениями.",
            "Верни только JSON с ключами approved (boolean), summary (string), issues (array of strings).",
            "summary и issues пиши только на русском языке.",
            "Будь строгим, но оценивай именно визуальное соответствие двух фотографий.",
            "Если фото сотрудника соответствует эталону и требованиям пункта, approved=true и issues=[].",
            "Если фото не соответствует, approved=false и перечисли только конкретные визуальные несоответствия между эталоном и фото сотрудника.",
            "Не используй размытые формулировки без деталей.",
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
                "Фото-эталон — это стандарт для сравнения.",
                "Фото сотрудника — это загруженное фото.",
                "Сравни наличие человека, форму, бейдж, опрятность, позу, общий вид и посторонние объекты.",
                "Если требования пункта и фото-эталон совпадают с фото сотрудника, ставь approved=true.",
                "Если есть сомнения, ставь approved=false и перечисляй только фактические визуальные отличия.",
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
    return {
      approved: Boolean(parsed.approved),
      summary: String(parsed.summary ?? "Фото проверено."),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((issue) => String(issue)).filter(Boolean)
        : [],
    };
  } catch {
    return {
      approved: false,
      summary: "Не удалось разобрать ответ OpenAI.",
      issues: [content.slice(0, 500) || "Пустой ответ"],
    };
  }
}
