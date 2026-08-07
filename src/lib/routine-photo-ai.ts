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
      summary: "OpenAI API key is missing. Manual review required.",
      issues: ["OPENAI_API_KEY is not configured on the server."],
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
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You review employee routine completion photos for retail staff. Compare the employee photo against the template photo and return only JSON with keys approved (boolean), summary (string), issues (array of strings). Be strict, concise, and practical. If the employee photo matches the template and requirements, approved=true and issues=[]. If not, approved=false and list specific issues.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Routine: ${routineTitle}`,
                `Checklist item: ${itemTitle}`,
                `Store: ${storeLabel}`,
                "Template photo is the reference standard.",
                "Employee photo is the submitted photo.",
                "Focus on visual compliance for the checklist item, including neatness, uniform, badge visibility, and overall presentation when relevant.",
                "Return only JSON.",
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
    throw new Error(`OpenAI review failed: ${response.status} ${detail}`.trim());
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = parseJsonResponse(content);
    return {
      approved: Boolean(parsed.approved),
      summary: String(parsed.summary ?? ""),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((issue) => String(issue)).filter(Boolean) : [],
    };
  } catch {
    return {
      approved: false,
      summary: "OpenAI response could not be parsed.",
      issues: [content.slice(0, 500) || "Empty response"],
    };
  }
}
