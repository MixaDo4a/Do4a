import { ClipboardCheck, Save } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PhotoFileInput } from "@/components/photo-file-input";
import { SectionHeader } from "@/components/section-header";
import { CHECKLIST_ROLES, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { cleanText, employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; salary?: string; score?: string }>;
};

type StoreRow = {
  id: string;
  name: string;
  city: string;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  employee_status: "padawan" | "experienced";
};

type TemplateRow = {
  id: string;
  name: string;
  checklist_items: {
    id: string;
    title: string;
    sort_order: number;
    checklist_item_weights: {
      employee_status: "padawan" | "experienced";
      weight_amount: number;
    }[];
  }[];
};

const messages: Record<string, string> = {
  required: "Выберите магазин, сотрудника и шаблон.",
  "access-error": "Не удалось определить проверяющего.",
  "employee-error": "Сотрудник не найден.",
  "template-error": "Шаблон чек-листа не найден.",
  "save-error": "Не удалось сохранить чек-лист.",
  saved: "Чек-лист сохранен.",
};

const statusLabels: Record<EmployeeRow["employee_status"], string> = {
  padawan: "Падаван",
  experienced: "Бывалый",
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function NewChecklistPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, CHECKLIST_ROLES)) {
    redirect("/");
  }

  const [storesResult, employeesResult, templatesResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, city")
      .eq("status", "active")
      .order("name")
      .returns<StoreRow[]>(),
    supabase
      .from("employees")
      .select("id, full_name, employee_status")
      .eq("is_active", true)
      .order("full_name")
      .returns<EmployeeRow[]>(),
    supabase
      .from("checklist_templates")
      .select("id, name, checklist_items(id, title, sort_order, checklist_item_weights(employee_status, weight_amount))")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .returns<TemplateRow[]>(),
  ]);

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  if (employeesResult.error) {
    throw new Error(employeesResult.error.message);
  }

  if (templatesResult.error) {
    throw new Error(templatesResult.error.message);
  }

  const template = templatesResult.data[0];
  const items = [...(template?.checklist_items ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order,
  );
  const message = params.message ? messages[params.message] : null;
  const canSubmit = storesResult.data.length > 0 && employeesResult.data.length > 0 && Boolean(template) && items.length > 0;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={ClipboardCheck} title="Чек-лист" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted">
            {message}
            {params.salary && params.score
              ? ` Средний балл: ${params.score}. Оклад за смену: ${money(Number(params.salary))} руб.`
              : ""}
          </p>
        ) : null}

        <form action="/checklists/new/submit" className="mt-4 grid gap-4" encType="multipart/form-data" method="post">
          <input name="template_id" type="hidden" value={template?.id ?? ""} />

          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Проверка</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Магазин</span>
                <select
                  className="h-11 ui-panel px-3 outline-none focus:border-brand"
                  name="store_id"
                >
                  {storesResult.data.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}, {store.city}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-muted">Сотрудник</span>
                <select
                  className="h-11 ui-panel px-3 outline-none focus:border-brand"
                  name="employee_id"
                >
                  {employeesResult.data.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeName(employee)} · {statusLabels[employee.employee_status]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {storesResult.data.length === 0 || employeesResult.data.length === 0 ? (
              <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">
                Для чек-листа нужен активный магазин и активный сотрудник.
              </p>
            ) : null}
          </section>

          <section className="ui-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{template?.name ?? "Шаблон не найден"}</h2>
              <span className="text-sm text-muted">{items.length} пунктов</span>
            </div>

            <div className="mt-4 grid gap-3">
              {!template || items.length === 0 ? (
                <p className="rounded-md bg-surface p-3 text-sm text-muted">
                  Активный шаблон чек-листа не найден. Сначала добавьте шаблон и пункты проверки.
                </p>
              ) : null}

              {items.map((item) => {
                const experiencedWeight =
                  item.checklist_item_weights.find((weight) => weight.employee_status === "experienced")
                    ?.weight_amount ?? 0;
                const padawanWeight =
                  item.checklist_item_weights.find((weight) => weight.employee_status === "padawan")
                    ?.weight_amount ?? 0;

                return (
                  <fieldset key={item.id} className="rounded-md border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <legend className="font-medium">{cleanText(item.title, "Пункт чек-листа")}</legend>
                      <span className="shrink-0 text-xs text-muted">
                        {money(experiencedWeight)} / {money(padawanWeight)} руб.
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted">Оценка</span>
                        <input
                          className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand"
                          defaultValue={10}
                          inputMode="numeric"
                          max={10}
                          min={1}
                          name={`score_${item.id}`}
                          type="number"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted">Комментарий</span>
                        <input
                          className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand"
                          name={`comment_${item.id}`}
                          placeholder="Необязательно"
                        />
                      </label>
                    </div>

                    <PhotoFileInput
                      label="Добавить фото пункта"
                      name={`photo_${item.id}`}
                      required={false}
                    />
                  </fieldset>
                );
              })}
            </div>
          </section>

          <section className="ui-panel p-4">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Комментарий к проверке</span>
              <textarea
                className="min-h-24 ui-panel px-3 py-2 outline-none focus:border-brand"
                name="comment"
              />
            </label>
          </section>

          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
          >
            <Save size={18} /> Сохранить чек-лист
          </button>
        </form>
      </div>
      <BottomNav />
    </main>
  );
}



