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
  flattenRoutineTree,
  formatRoutineOutline,
  type RoutineKind,
  type RoutineTemplateItemFlatRow,
  type RoutineTemplateItemSettingsRow,
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

type TemplateSettingsMap = Record<
  string,
  {
    requiresPhoto: boolean;
    aiReviewEnabled: boolean;
    referencePhotoLabel: string | null;
  }
>;

const messages: Record<string, string> = {
  "routine-saved": "Распорядок дня сохранён.",
  "routine-error": "Не удалось сохранить распорядок дня.",
};

function buildTemplateSettingsMap(rows: RoutineTemplateItemSettingsRow[]): TemplateSettingsMap {
  return Object.fromEntries(
    rows.map((row) => [
      row.item_key,
      {
        requiresPhoto: row.requires_photo,
        aiReviewEnabled: row.ai_review_enabled,
        referencePhotoLabel: row.reference_photo_file ? `${row.reference_photo_file.bucket}/${row.reference_photo_file.path}` : null,
      },
    ]),
  );
}

function RoutineItemSettingsRow({
  title,
  itemKey,
  depth,
  settings,
}: {
  title: string;
  itemKey: string;
  depth: number;
  settings?: TemplateSettingsMap[string];
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-[#0d090a]/90 p-3 shadow-soft" style={{ marginLeft: depth * 16 }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-1 text-xs text-muted">Ключ пункта: {itemKey}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
          <label className="flex items-center gap-2 rounded-2xl border border-line/80 bg-[#120b0d] px-3 py-2 text-sm">
            <input
              className="h-4 w-4 accent-brand"
              defaultChecked={settings?.requiresPhoto ?? false}
              name={`requires_photo_${itemKey}`}
              type="checkbox"
            />
            Фото обязательно
          </label>
          <label className="flex items-center gap-2 rounded-2xl border border-line/80 bg-[#120b0d] px-3 py-2 text-sm">
            <input
              className="h-4 w-4 accent-brand"
              defaultChecked={settings?.aiReviewEnabled ?? false}
              disabled={!settings?.requiresPhoto}
              name={`ai_review_enabled_${itemKey}`}
              type="checkbox"
            />
            AI-проверка
          </label>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <label className="grid gap-2 text-sm text-muted">
          <span>Фото-стандарт пункта</span>
          <input
            accept="image/*"
            className="block w-full rounded-2xl border border-line/80 bg-[#0b0809] px-3 py-2 text-sm text-ink file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white"
            name={`reference_photo_${itemKey}`}
            type="file"
          />
        </label>
        {settings?.referencePhotoLabel ? <p className="text-xs text-brand">Текущий стандарт: {settings.referencePhotoLabel}</p> : null}
      </div>
    </div>
  );
}

function RoutineSettingsTree({
  nodes,
  settingsMap,
  depth = 0,
}: {
  nodes: Array<{ title: string; itemKey?: string; children: Array<{ title: string; itemKey?: string; children: any[] }> }>;
  settingsMap: TemplateSettingsMap;
  depth?: number;
}) {
  return (
    <div className="grid gap-3">
      {nodes.map((node) => {
        const itemKey = node.itemKey ?? node.title;
        return (
          <div key={itemKey} className="grid gap-3">
            <RoutineItemSettingsRow title={node.title} itemKey={itemKey} depth={depth} settings={settingsMap[itemKey]} />
            {node.children.length > 0 ? (
              <div className="grid gap-3">
                <RoutineSettingsTree nodes={node.children} settingsMap={settingsMap} depth={depth + 1} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RoutineSettingsForm({
  storeId,
  template,
  kind,
  title,
  outline,
  settingsMap,
}: {
  storeId: string;
  template: TemplateRow | undefined;
  kind: RoutineKind;
  title: string;
  outline: string;
  settingsMap: TemplateSettingsMap;
}) {
  const tree = template ? buildRoutineTree(template.day_routine_template_items) : [];
  const itemKeys = flattenRoutineTree(tree)
    .map((node) => node.itemKey ?? node.id)
    .filter((value): value is string => Boolean(value));

  return (
    <section className="ui-panel p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
          {kind === "morning" ? <SunMedium size={18} /> : <Sunset size={18} />}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted">Пункты распорядка и фото-настройки для этого магазина.</p>
        </div>
      </div>

      <form action="/admin/routine/save" method="post" className="mt-4 grid gap-3">
        <input name="store_id" type="hidden" value={storeId} />
        <input name="routine_kind" type="hidden" value={kind} />
        <input name="title" type="hidden" value={template?.title ?? title} />
        <textarea
          className="min-h-[240px] rounded-2xl border border-line bg-[#0d090a]/92 p-4 text-sm leading-6"
          name="outline"
          defaultValue={outline}
        />
        <button className="h-12 rounded-2xl bg-brand px-6 font-semibold text-white">Сохранить распорядок</button>
      </form>

      <div className="mt-6 rounded-3xl border border-line/80 bg-[#0b0809]/96 p-4">
        <h3 className="font-semibold">Фото-пункты</h3>
        <p className="mt-1 text-sm text-muted">
          Для каждого пункта можно включить обязательное фото, AI-проверку и загрузить фото-стандарт для сравнения
          снимков сотрудников.
        </p>

        {template ? (
          <form action="/admin/routine/settings" method="post" encType="multipart/form-data" className="mt-4 grid gap-4">
            <input name="store_id" type="hidden" value={storeId} />
            <input name="template_id" type="hidden" value={template.id} />
            <input name="routine_kind" type="hidden" value={kind} />
            <input name="item_keys" type="hidden" value={JSON.stringify(itemKeys)} />
            <RoutineSettingsTree nodes={tree as any} settingsMap={settingsMap} />
            <button className="h-12 rounded-2xl bg-brand px-6 font-semibold text-white">Сохранить фото-настройки</button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Сначала сохраните текст распорядка, чтобы появился список пунктов и можно было включить фото-стандарты для
            них.
          </p>
        )}
      </div>
    </section>
  );
}

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
        .select(
          "id, store_id, routine_kind, title, day_routine_template_items(id, item_key, parent_item_id, title, level, sort_order, is_active)",
        )
        .eq("store_id", selectedStoreId)
        .in("routine_kind", ["morning", "evening"])
        .returns<TemplateRow[]>()
    : { data: [] as TemplateRow[], error: null };

  if (templateError) {
    throw new Error(templateError.message);
  }

  const { data: settingsRows, error: settingsError } = selectedStoreId
    ? await supabase
        .from("day_routine_template_item_settings")
        .select("id, template_id, item_key, requires_photo, ai_review_enabled, reference_photo_file_id, reference_photo_file:files(id, bucket, path, mime_type)")
        .in(
          "template_id",
          (templateRows ?? []).map((template) => template.id),
        )
        .returns<RoutineTemplateItemSettingsRow[]>()
    : { data: [] as RoutineTemplateItemSettingsRow[], error: null };

  if (settingsError) {
    throw new Error(settingsError.message);
  }

  const templatesByKind = new Map<RoutineKind, TemplateRow>();
  (templateRows ?? []).forEach((template) => {
    templatesByKind.set(template.routine_kind, template);
  });

  const settingsByTemplateId = new Map<string, TemplateSettingsMap>();
  for (const template of templateRows ?? []) {
    settingsByTemplateId.set(
      template.id,
      buildTemplateSettingsMap((settingsRows ?? []).filter((row) => row.template_id === template.id)),
    );
  }

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
            <RoutineSettingsForm
              kind="morning"
              outline={morningOutline}
              settingsMap={settingsByTemplateId.get(morningTemplate?.id ?? "") ?? {}}
              storeId={selectedStoreId}
              template={morningTemplate}
              title="Утренний распорядок"
            />
            <RoutineSettingsForm
              kind="evening"
              outline={eveningOutline}
              settingsMap={settingsByTemplateId.get(eveningTemplate?.id ?? "") ?? {}}
              storeId={selectedStoreId}
              template={eveningTemplate}
              title="Вечерний распорядок"
            />

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
