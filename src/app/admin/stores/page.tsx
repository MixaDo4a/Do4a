import { ClipboardList, Settings, Store, StoreIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { cleanText } from "@/lib/display";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type StoreRow = {
  id: string;
  city: string;
  name: string;
  address: string | null;
  workday_start_time: string | null;
  workday_end_time: string | null;
  status: string;
  sales_share_percent: number | null;
};

type TemplateItemRow = {
  id: string;
  title: string;
  sort_order: number;
  checklist_item_weights: {
    employee_status: "padawan" | "experienced";
    weight_amount: number;
  }[];
};

type StoreChecklistSettingRow = {
  store_id: string;
  item_id: string;
  is_enabled: boolean;
  custom_title: string | null;
  weight_padawan: number;
  weight_experienced: number;
};

const ADVANCED_ROLES = ["super_admin", "developer"];

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export default async function AdminStoresPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    redirect("/");
  }

  const canCreateStore = roles.some((role) => ADVANCED_ROLES.includes(role));
  const canEditAdvanced = canCreateStore;
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const [storesResult, templatesResult, settingsResult] = await Promise.all([
    accessibleStoreIds.length > 0
      ? supabase
          .from("stores")
          .select("id, city, name, address, workday_start_time, workday_end_time, status, sales_share_percent")
          .in("id", accessibleStoreIds)
          .order("city")
          .order("name")
          .returns<StoreRow[]>()
      : Promise.resolve({ data: [] as StoreRow[], error: null }),
    supabase
      .from("checklist_templates")
      .select("id, name, checklist_items(id, title, sort_order, checklist_item_weights(employee_status, weight_amount))")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .returns<{ id: string; name: string; checklist_items: TemplateItemRow[] }[]>(),
    accessibleStoreIds.length > 0
      ? supabase
          .from("store_checklist_item_settings")
          .select("store_id, item_id, is_enabled, custom_title, weight_padawan, weight_experienced")
          .in("store_id", accessibleStoreIds)
          .returns<StoreChecklistSettingRow[]>()
      : Promise.resolve({ data: [] as StoreChecklistSettingRow[], error: null }),
  ]);

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  if (templatesResult.error) {
    throw new Error(templatesResult.error.message);
  }

  if (settingsResult.error) {
    throw new Error(settingsResult.error.message);
  }

  const template = templatesResult.data[0];
  const checklistItems = [...(template?.checklist_items ?? [])].sort((left, right) => left.sort_order - right.sort_order);

  const settingsByStore = new Map<string, Map<string, StoreChecklistSettingRow>>();
  for (const setting of settingsResult.data ?? []) {
    if (!settingsByStore.has(setting.store_id)) {
      settingsByStore.set(setting.store_id, new Map());
    }
    settingsByStore.get(setting.store_id)?.set(setting.item_id, setting);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Settings} title="Управление" showBack />

        {canCreateStore ? (
          <section className="mt-4 ui-panel p-4">
            <SectionHeader icon={StoreIcon} title="Создать магазин" />
            <form action="/admin/stores/create" className="mt-4 grid gap-3" method="post">
              <input className="h-11 rounded-md border border-line px-3" name="city" placeholder="Город" required />
              <input className="h-11 rounded-md border border-line px-3" name="name" placeholder="Название" required />
              <input className="h-11 rounded-md border border-line px-3" name="address" placeholder="Адрес" />
              <div className="grid gap-2">
                <input className="h-11 rounded-md border border-line px-3" defaultValue="10:00" name="start_time" type="time" />
                <input className="h-11 rounded-md border border-line px-3" defaultValue="21:00" name="end_time" type="time" />
              </div>
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Создать магазин</button>
            </form>
          </section>
        ) : null}

        <section className="mt-6 ui-panel p-4">
          <SectionHeader icon={Store} title="Все магазины" />
          <div className="mt-4 grid gap-3">
            {storesResult.data?.map((storeItem) => {
              const storeSettings = settingsByStore.get(storeItem.id) ?? new Map<string, StoreChecklistSettingRow>();
              const percentValue = storeItem.sales_share_percent ?? 2;

              return (
                <details key={storeItem.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                  <summary className="cursor-pointer list-none font-semibold">
                    {storeItem.name} · {storeItem.city}
                  </summary>

                  <form action="/admin/stores/update" className="mt-3 grid gap-3" method="post">
                    <input name="store_id" type="hidden" value={storeItem.id} />

                    <div className="grid gap-2">
                      <input className="h-10 rounded-md border border-line px-3" name="city" defaultValue={storeItem.city} required />
                      <input className="h-10 rounded-md border border-line px-3" name="name" defaultValue={storeItem.name} required />
                    </div>

                    <input className="h-10 rounded-md border border-line px-3" name="address" defaultValue={storeItem.address ?? ""} placeholder="Адрес" />

                    <div className="grid gap-2">
                      <input className="h-10 rounded-md border border-line px-3" defaultValue={storeItem.workday_start_time ?? ""} name="start_time" type="time" />
                      <input className="h-10 rounded-md border border-line px-3" defaultValue={storeItem.workday_end_time ?? ""} name="end_time" type="time" />
                    </div>

                    <select className="h-10 rounded-md border border-line px-3" name="status" defaultValue={storeItem.status}>
                      <option value="active">Активен</option>
                      <option value="archived">Архив</option>
                    </select>

                    <div className="ui-panel p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">Процент от продаж</p>
                        <span className="text-xs text-muted">Сейчас: {money(percentValue)}%</span>
                      </div>

                      {canEditAdvanced ? (
                        <label className="mt-3 grid gap-1 text-sm">
                          <span className="text-muted">Процент менеджерам</span>
                          <div className="flex items-center gap-2">
                            <input
                              className="h-10 w-full rounded-md border border-line px-3"
                              defaultValue={percentValue}
                              min={0}
                              max={100}
                              name="sales_share_percent"
                              step="0.01"
                              type="number"
                            />
                            <span className="shrink-0 text-muted">%</span>
                          </div>
                        </label>
                      ) : (
                        <p className="mt-2 text-sm text-muted">Изменение доступно только супер-админу и разработчику.</p>
                      )}
                    </div>

                    {canEditAdvanced ? (
                      <section className="ui-panel p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">Настройка чек-листа магазина</p>
                            <p className="text-xs text-muted">Можно переименовывать пункты и менять их стоимость для Падавана и Бывалого.</p>
                          </div>
                          <ClipboardList className="h-4 w-4 text-brand" />
                        </div>

                        {!template || checklistItems.length === 0 ? (
                          <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">
                            Шаблон чек-листа не найден.
                          </p>
                        ) : (
                          <div className="mt-3 grid max-h-96 gap-3 overflow-y-auto pr-1">
                            {checklistItems.map((item) => {
                              const setting = storeSettings.get(item.id);
                              const experiencedDefault =
                                item.checklist_item_weights.find((weight) => weight.employee_status === "experienced")
                                  ?.weight_amount ?? 0;
                              const padawanDefault =
                                item.checklist_item_weights.find((weight) => weight.employee_status === "padawan")
                                  ?.weight_amount ?? 0;
                              const isEnabled = setting ? setting.is_enabled : true;
                              const padawanValue = setting?.weight_padawan ?? padawanDefault;
                              const experiencedValue = setting?.weight_experienced ?? experiencedDefault;
                              const titleValue = setting?.custom_title ?? item.title;

                              return (
                                <fieldset key={item.id} className="rounded-md border border-line p-3">
                                  <label className="flex items-start gap-2 font-medium">
                                    <input
                                      defaultChecked={isEnabled}
                                      name={`checklist_enabled_${item.id}`}
                                      type="checkbox"
                                      className="mt-1 h-4 w-4"
                                    />
                                    <span>{cleanText(item.title, "Название пункта")}</span>
                                  </label>

                                  <label className="mt-3 grid gap-1 text-sm">
                                    <span className="text-muted">Название пункта</span>
                                    <input
                                      className="h-10 rounded-md border border-line px-3"
                                      defaultValue={titleValue}
                                      name={`checklist_title_${item.id}`}
                                    />
                                  </label>

                                  <div className="mt-3 grid gap-2">
                                    <label className="grid gap-1 text-sm">
                                      <span className="text-muted">Падаван, руб.</span>
                                      <input
                                        className="h-10 rounded-md border border-line px-3"
                                        defaultValue={padawanValue}
                                        min={0}
                                        name={`checklist_padawan_${item.id}`}
                                        step="0.01"
                                        type="number"
                                      />
                                    </label>

                                    <label className="grid gap-1 text-sm">
                                      <span className="text-muted">Бывалый, руб.</span>
                                      <input
                                        className="h-10 rounded-md border border-line px-3"
                                        defaultValue={experiencedValue}
                                        min={0}
                                        name={`checklist_experienced_${item.id}`}
                                        step="0.01"
                                        type="number"
                                      />
                                    </label>
                                  </div>
                                </fieldset>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    ) : null}

                    <button className="h-10 rounded-md bg-brand px-4 font-semibold text-white">Сохранить магазин</button>
                  </form>
                </details>
              );
            })}
          </div>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}




