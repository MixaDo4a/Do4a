import { CirclePlay } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, OPEN_SHIFT_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string }>;
};

type StoreRow = {
  id: string;
  city: string;
  name: string;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  primary_store_id: string | null;
};

const messages: Record<string, string> = {
  required: "Выберите магазин и основного продавца.",
  "same-seller": "Основной и второй продавец должны быть разными сотрудниками.",
  "open-error": "Не удалось открыть смену.",
  opened: "Смена открыта.",
};

export default async function OpenShiftPage({ searchParams }: PageProps) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, OPEN_SHIFT_ROLES)) {
    redirect("/shifts");
  }

  const [accessibleStores, employeesResult] = await Promise.all([
    getAccessibleStores(),
    supabase
      .from("employees")
      .select("id, full_name, primary_store_id")
      .eq("is_active", true)
      .order("full_name")
      .returns<EmployeeRow[]>(),
  ]);

  if (employeesResult.error) {
    throw new Error(employeesResult.error.message);
  }

  const employees = employeesResult.data.map((employee) => ({
    ...employee,
    full_name: employeeName(employee),
  }));
  const storeIds = new Set(accessibleStores.map((store) => store.id));
  const filteredEmployees = employees.filter((employee) => employee.primary_store_id ? storeIds.has(employee.primary_store_id) : true);
  const canOpen = accessibleStores.length > 0 && filteredEmployees.length > 0;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={CirclePlay} title="Открытие смены" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        <form action="/shifts/open/submit" className="mt-4 grid gap-4" method="post">
          <section className="ui-panel p-4">
            <h2 className="font-semibold">Смена</h2>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Магазин</span>
                  <select className="h-11 rounded-md border border-line px-3" name="store_id">
                  {accessibleStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}, {store.city}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Дата</span>
                <input
                  className="h-11 rounded-md border border-line px-3"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  name="shift_date"
                  type="date"
                />
              </label>
            </div>
          </section>

          <section className="ui-panel p-4">
            <h2 className="font-semibold">Продавцы</h2>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Основной продавец</span>
                <select className="h-11 rounded-md border border-line px-3" name="primary_employee_id">
                  {filteredEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Второй продавец</span>
                <select className="h-11 rounded-md border border-line px-3" name="secondary_employee_id">
                  <option value="">Без второго продавца</option>
                  {filteredEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-muted">
                Основной продавец получает 2% от оборота смены, второй продавец получает 1%.
              </p>
            </div>
          </section>

          {!canOpen ? (
            <p className="rounded-md bg-white p-3 text-sm text-muted shadow-soft">
              Для открытия смены нужен активный магазин и активный сотрудник.
            </p>
          ) : null}

          <button
            className="h-12 rounded-md bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canOpen}
          >
            Открыть смену
          </button>
        </form>
      </div>
      <BottomNav />
    </main>
  );
}



