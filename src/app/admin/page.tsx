import { Archive, CalendarClock, CalendarPlus, Settings, Store, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { ClipboardCheck, PackageSearch } from "lucide-react";
import { SectionHeader } from "@/components/section-header";
import { DEDUCTION_ROLES, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string }>;
};

const messages: Record<string, string> = {
  "store-created": "Магазин создан.",
  "employee-created": "Сотрудник создан.",
  "schedule-created": "График сохранён.",
  "store-plan-saved": "План магазина сохранён.",
  "payroll-adjustment-saved": "Корректировка зарплаты сохранена.",
  "store-updated": "Магазин обновлён.",
  "employee-updated": "Сотрудник обновлён.",
  "employee-deleted": "Сотрудник удалён.",
  "employee-restored": "Сотрудник восстановлен.",
  "store-archived": "Магазин скрыт.",
  "store-restored": "Магазин восстановлен.",
  "admin-required": "Заполните обязательные поля.",
  "admin-error": "Что-то пошло не так.",
};

export default async function AdminPage({ searchParams }: PageProps) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, DEDUCTION_ROLES)) {
    redirect("/");
  }
  const fullAdminView = hasAnyRole(roles, MANAGE_ROLES);
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !fullAdminView;
  const { data: warehouseEmployees, error: employeesError } = warehouseManagerOnly
    ? await supabase.rpc("list_warehouse_deduction_employees")
    : { data: [], error: null };
  const accessibleEmployees = (warehouseEmployees ?? []) as { id: string; full_name: string }[];

  const canRunNotificationCron = roles.some((role) => ["super_admin", "developer"].includes(role));

  return (
    <>
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Settings} title={warehouseManagerOnly ? "Вычеты" : "Управление"} showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        {canRunNotificationCron ? (
          <form action="/api/routine/reminders" className="mt-4 flex justify-end" method="post">
              <button className="h-10 ui-panel px-4 text-sm font-semibold text-ink shadow-soft">
                Запустить уведомления
              </button>
          </form>
        ) : null}

        {warehouseManagerOnly ? (
          <section className="mt-4 ui-panel p-4">
            <h2 className="font-semibold">Новый вычет</h2>
            {employeesError ? <p className="mt-3 text-sm text-brand">Не удалось загрузить сотрудников: {employeesError.message}</p> : null}
            {!employeesError && (accessibleEmployees?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-muted">Нет сотрудников, привязанных к магазинам вашего города.</p>
            ) : null}
            {(accessibleEmployees?.length ?? 0) > 0 ? (
              <form action="/admin/payroll-adjustments/create" className="mt-4 grid gap-3" method="post">
                <label className="grid gap-1 text-sm">
                  <span>Сотрудник</span>
                  <select className="h-11 rounded-md border border-line bg-surface px-3" name="employee_id" required defaultValue="">
                    <option value="" disabled>Выберите сотрудника</option>
                    {accessibleEmployees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Месяц начисления</span>
                  <input className="h-11 rounded-md border border-line bg-surface px-3" defaultValue={new Date().toISOString().slice(0, 7)} name="month" required type="month" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Вид вычета</span>
                  <select className="h-11 rounded-md border border-line bg-surface px-3" name="adjustment_type" required>
                    <option value="fine">Штраф</option>
                    <option value="inventory">Инвентаризация</option>
                    <option value="expiration">Просрочка</option>
                    <option value="product">Товар</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Сумма, ₽</span>
                  <input className="h-11 rounded-md border border-line bg-surface px-3" min="0.01" name="amount" required step="0.01" type="number" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Причина</span>
                  <textarea className="min-h-20 rounded-md border border-line bg-surface px-3 py-2" name="reason" required />
                </label>
                <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white" type="submit">Сохранить вычет</button>
              </form>
            ) : null}
          </section>
        ) : null}

        {!warehouseManagerOnly ? (
        <section className="mt-4 grid gap-4">
          <div className="ui-panel p-4">
            <SectionHeader icon={Store} title="Магазины" action="Открыть" href="/admin/stores" />
            <p className="mt-3 text-sm text-muted">Создание и редактирование магазинов перенесено в отдельный раздел.</p>
          </div>
          <div className="ui-panel p-4">
            <SectionHeader icon={UserPlus} title="Сотрудники" action="Открыть" href="/admin/employees" />
            <p className="mt-3 text-sm text-muted">Создание и редактирование сотрудников перенесено в отдельный раздел.</p>
          </div>
        </section>
        ) : null}

        {!warehouseManagerOnly ? (
        <section className="mt-6 ui-panel p-4">
          <SectionHeader icon={CalendarPlus} title="График работы" action="Редактировать" href="/admin/schedule" />
          <p className="mt-3 text-sm text-muted">
            График вынесен в отдельный редактор с горизонтальной таблицей. В списке сотрудников будут только те, у кого есть доступ к выбранному магазину.
          </p>
        </section>
        ) : null}

        {!warehouseManagerOnly ? (
          <section className="mt-4 grid gap-4">
            <div className="ui-panel p-4">
              <SectionHeader icon={Archive} title="Закрытые смены" action="Открыть" href="/admin/closed-shifts" />
              <p className="mt-3 text-sm text-muted">
                Здесь можно просматривать закрытые и автозакрытые смены по магазинам в подчинении с фильтрами по периоду и статусу.
              </p>
            </div>
            <div className="ui-panel p-4">
              <SectionHeader icon={CalendarClock} title="Распорядок дня" action="Редактировать" href="/admin/routine" />
              <p className="mt-3 text-sm text-muted">
                Утренний и вечерний распорядок редактируются отдельно по каждому магазину.
              </p>
            </div>
            <div className="ui-panel p-4">
              <SectionHeader icon={PackageSearch} title="Акции" action="Открыть" href="/procurement" />
              <p className="mt-3 text-sm text-muted">Создание акций, действующие акции и архив.</p>
            </div>
            <div className="ui-panel p-4">
              <SectionHeader icon={ClipboardCheck} title="Чек-листы" />
              <div className="mt-3 flex gap-2 text-sm">
                <Link className="ui-panel px-3 py-2 font-semibold" href="/checklists/new">Провести чек-лист</Link>
                <Link className="ui-panel px-3 py-2 font-semibold" href="/checklists">Архив чек-листов</Link>
              </div>
            </div>
          </section>
        ) : null}

      </div>
    </main>
    <BottomNav />
    </>
  );
}












