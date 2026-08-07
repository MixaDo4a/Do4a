import { CalendarClock } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { RoutineChecklistClient } from "@/components/routine-checklist-client";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId } from "@/lib/auth/roles";
import {
  buildRoutineTree,
  routineKindLabel,
  type RoutineKind,
  type RoutineTemplateItemFlatRow,
  type RoutineTemplateItemSettingsRow,
} from "@/lib/routine";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ shiftId?: string; message?: string; detail?: string }>;
};

type ShiftRow = {
  id: string;
  store_id: string;
  shift_date: string;
  opened_by_employee_id: string;
};

type RoutineTemplateRow = {
  id: string;
  store_id: string;
  routine_kind: RoutineKind;
  title: string;
  day_routine_template_items: RoutineTemplateItemFlatRow[];
};

type TemplateSettingsMap = Record<
  string,
  {
    requiresPhoto: boolean;
    aiReviewEnabled: boolean;
  }
>;

type SessionRow = {
  id: string;
  started_at: string;
  started_notification_sent_at: string | null;
  completed_at: string | null;
  day_routine_session_items: {
    template_item_id: string | null;
    completed_at: string;
    title_snapshot: string;
  }[];
};

const messages: Record<string, string> = {
  "shift-opened": "Распорядок дня открыт после начала смены.",
  "routine-saved": "Распорядок дня сохранён.",
  "routine-error": "Не удалось загрузить распорядок дня.",
};

export default async function RoutineKindPage({ params, searchParams }: PageProps) {
  const { kind } = await params;
  if (kind !== "morning" && kind !== "evening") {
    redirect("/routine");
  }

  const { shiftId, message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { employeeId } = await getCurrentEmployeeId();

  let shiftQuery = supabase
    .from("shifts")
    .select("id, store_id, shift_date, opened_by_employee_id")
    .eq("status", "opened")
    .order("shift_date", { ascending: false });

  if (shiftId) {
    shiftQuery = shiftQuery.eq("id", shiftId);
  } else if (employeeId) {
    shiftQuery = shiftQuery.eq("opened_by_employee_id", employeeId);
  }

  const { data: shiftData, error: shiftError } = await shiftQuery.limit(1).maybeSingle<ShiftRow>();
  if (shiftError) {
    throw new Error(shiftError.message);
  }

  if (!shiftData) {
    return (
      <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
        <div className="mx-auto max-w-4xl">
          <SectionHeader icon={CalendarClock} title={routineKindLabel(kind as RoutineKind)} showBack />
          <section className="mt-4 ui-panel p-4 text-sm text-muted shadow-soft">
            Сейчас нет открытой смены для просмотра распорядка.
          </section>
        </div>
        <BottomNav />
      </main>
    );
  }

  const [
    { data: templateRows, error: templateError },
    { data: sessionRows, error: sessionError },
    { data: storeRow, error: storeError },
    { data: employeeRow, error: employeeError },
  ] = await Promise.all([
    supabase
      .from("day_routine_templates")
      .select(
        "id, store_id, routine_kind, title, day_routine_template_items(id, parent_item_id, title, level, sort_order, is_active)",
      )
      .eq("store_id", shiftData.store_id)
      .eq("routine_kind", kind)
      .maybeSingle<RoutineTemplateRow>(),
    supabase
      .from("day_routine_sessions")
      .select(
        "id, started_at, started_notification_sent_at, completed_at, day_routine_session_items(template_item_id, completed_at, title_snapshot)",
      )
      .eq("shift_id", shiftData.id)
      .eq("employee_id", shiftData.opened_by_employee_id)
      .eq("routine_kind", kind)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<SessionRow>(),
    supabase.from("stores").select("id, name, city").eq("id", shiftData.store_id).maybeSingle<{ id: string; name: string; city: string }>(),
    supabase.from("employees").select("id, full_name").eq("id", shiftData.opened_by_employee_id).maybeSingle<{ id: string; full_name: string }>(),
  ]);

  if (templateError) {
    throw new Error(templateError.message);
  }

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (storeError) {
    throw new Error(storeError.message);
  }

  if (employeeError) {
    throw new Error(employeeError.message);
  }

  const { data: settingsRows, error: settingsError } = templateRows
    ? await supabase
        .from("day_routine_template_item_settings")
        .select("id, template_id, item_key, requires_photo, ai_review_enabled")
        .eq("template_id", templateRows.id)
        .returns<RoutineTemplateItemSettingsRow[]>()
    : { data: [] as RoutineTemplateItemSettingsRow[], error: null };

  const templateSettingsRows =
    settingsError && /does not exist|Could not find the table|Could not find the relationship/i.test(settingsError.message)
      ? []
      : (() => {
          if (settingsError) {
            throw new Error(settingsError.message);
          }
          return settingsRows ?? [];
        })();

  const template = templateRows?.day_routine_template_items ?? [];
  const tree = buildRoutineTree(template);
  const itemSettings: TemplateSettingsMap = Object.fromEntries(
    templateSettingsRows.map((row) => [
      row.item_key,
      {
        requiresPhoto: row.requires_photo,
        aiReviewEnabled: row.ai_review_enabled,
      },
    ]),
  );
  const sessionItems = Object.fromEntries(
    (sessionRows?.day_routine_session_items ?? []).map((item) => [
      String(item.template_item_id ?? item.title_snapshot),
      { completedAt: item.completed_at },
    ]),
  );

  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : "Магазин";
  const title = `${routineKindLabel(kind as RoutineKind)} · ${storeLabel}`;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={CalendarClock} title={title} showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4">
          <section className="ui-panel p-4 shadow-soft">
            <p className="text-sm text-muted">
              Смена:{" "}
              {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(
                new Date(shiftData.shift_date),
              )}
            </p>
            <p className="mt-1 text-sm text-muted">
              Сотрудник: <span className="font-semibold text-ink">{employeeRow?.full_name ?? "Сотрудник"}</span>
            </p>
          </section>

          {templateRows && tree.length > 0 ? (
            <RoutineChecklistClient
              shiftId={shiftData.id}
              kind={kind as RoutineKind}
              title={templateRows.title}
              items={tree}
              itemSettings={itemSettings}
              sessionItems={sessionItems}
              startedAt={sessionRows?.started_at ?? null}
              completedAt={sessionRows?.completed_at ?? null}
            />
          ) : (
            <section className="ui-panel p-4 text-sm text-muted shadow-soft">
              Для этого магазина пока не настроен шаблон распорядка дня.
            </section>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
