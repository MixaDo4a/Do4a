import { CalendarClock, SunMedium, Sunset } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import {
  buildRoutineTree,
  defaultRoutineOutlineText,
  formatRoutineOutline,
  type RoutineKind,
  type RoutineTemplateItemFlatRow,
} from "@/lib/routine";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ storeId?: string; message?: string; detail?: string }>;
};

type StoreRow = {
  id: string;
  name: string;
  city: string;
  status: string;
};

type TemplateRow = {
  id: string;
  store_id: string;
  routine_kind: RoutineKind;
  title: string;
  day_routine_template_items: RoutineTemplateItemFlatRow[];
};

const messages: Record<string, string> = {
  "routine-saved": "Распорядок дня сохранён.",
  "routine-error": "Не удалось сохранить распорядок дня.",
};

export default async function AdminRoutinePage({ searchParams }: PageProps) {
  const { storeId: selectedStoreParam, message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    redirect("/");
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const { data: storesData, error: storesError } =
    accessibleStoreIds.length > 0
      ? await supabase
          .from("stores")
          .select("id, name, city, status")
          .in("id", accessibleStoreIds)
          .order("city")
          .order("name")
          .returns<StoreRow[]>()
      : { data: [] as StoreRow[], error: null };

  if (storesError) {
    throw new Error(storesError.message);
  }

  const activeStores = (storesData ?? []).filter((store) => store.status === "active");
  const selectedStoreId = selectedStoreParam && activeStores.some((store) => store.id === selectedStoreParam)
    ? selectedStoreParam
    : activeStores[0]?.id ?? "";

  const { data: templateRows, error: templateError } = selectedStoreId
    ? await supabase
        .from("day_routine_templates")
        .select("id, store_id, routine_kind, title, day_routine_template_items(id, parent_item_id, title, level, sort_order, is_active)")
        .eq("store_id", selectedStoreId)
        .in("routine_kind", ["morning", "evening"])
        .returns<TemplateRow[]>()
    : { data: [] as TemplateRow[], error: null };

  if (templateError) {
    throw new Error(templateError.message);
  }

  const templatesByKind = new Map<RoutineKind, TemplateRow>();
  (templateRows ?? []).forEach((template) => {
    templatesByKind.set(template.routine_kind, template);
  });

  const morningTemplate = templatesByKind.get("morning");
  const eveningTemplate = templatesByKind.get("evening");
  const morningOutline = morningTemplate ? formatRoutineOutline(buildRoutineTree(morningTemplate.day_routine_template_items)) : defaultRoutineOutlineText("morning");
  const eveningOutline = eveningTemplate ? formatRoutineOutline(buildRoutineTree(eveningTemplate.day_routine_template_items)) : defaultRoutineOutlineText("evening");

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={CalendarClock} title="Распорядок дня" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        <section className="mt-4 ui-panel p-4 shadow-soft">
          <form className="grid gap-3 sm:grid-cols-[minmax(220px,320px)_auto]" method="get">
            <select className="h-12 rounded-md border border-line px-4" name="storeId" defaultValue={selectedStoreId}>
              {activeStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}, {store.city}
                </option>
              ))}
            </select>
            <button className="h-12 rounded-md bg-brand px-6 font-semibold text-white">Показать</button>
          </form>
        </section>

        {activeStores.length === 0 ? (
          <section className="mt-4 ui-panel p-4 text-sm text-muted shadow-soft">Нет доступных активных магазинов.</section>
        ) : null}

        {selectedStoreId ? (
          <div className="mt-4 grid gap-4">
            <section className="ui-panel p-4 shadow-soft">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
                  <SunMedium size={18} />
                </span>
                <div>
                  <h2 className="font-semibold">Утренний распорядок</h2>
                  <p className="text-sm text-muted">Редактирование пунктов для открытия смены</p>
                </div>
              </div>

              <form action="/admin/routine/save" method="post" className="mt-4 grid gap-3">
                <input name="store_id" type="hidden" value={selectedStoreId} />
                <input name="routine_kind" type="hidden" value="morning" />
                <input name="title" type="hidden" value={morningTemplate?.title ?? "Утренний распорядок"} />
                <textarea
                  className="min-h-[320px] rounded-2xl border border-line bg-[#0d090a]/92 p-4 text-sm leading-6"
                  name="outline"
                  defaultValue={morningOutline}
                />
                <button className="h-12 rounded-2xl bg-brand px-6 font-semibold text-white">Сохранить утро</button>
              </form>
            </section>

            <section className="ui-panel p-4 shadow-soft">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
                  <Sunset size={18} />
                </span>
                <div>
                  <h2 className="font-semibold">Вечерний распорядок</h2>
                  <p className="text-sm text-muted">Редактирование пунктов для 19:00 напоминания</p>
                </div>
              </div>

              <form action="/admin/routine/save" method="post" className="mt-4 grid gap-3">
                <input name="store_id" type="hidden" value={selectedStoreId} />
                <input name="routine_kind" type="hidden" value="evening" />
                <input name="title" type="hidden" value={eveningTemplate?.title ?? "Вечерний распорядок"} />
                <textarea
                  className="min-h-[320px] rounded-2xl border border-line bg-[#0d090a]/92 p-4 text-sm leading-6"
                  name="outline"
                  defaultValue={eveningOutline}
                />
                <button className="h-12 rounded-2xl bg-brand px-6 font-semibold text-white">Сохранить вечер</button>
              </form>
            </section>

            <section className="ui-panel p-4 shadow-soft">
              <h2 className="font-semibold">Быстрые ссылки</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Link className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-4 transition hover:border-brand/60" href="/routine">
                  Открыть распорядок
                </Link>
                <Link className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-4 transition hover:border-brand/60" href={`/routine/archive/${selectedStoreId}`}>
                  Архив магазина
                </Link>
              </div>
            </section>
          </div>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}

