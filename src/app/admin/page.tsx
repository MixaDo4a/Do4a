import { Archive, CalendarClock, CalendarPlus, Settings, Store, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { Banknote, ClipboardCheck, PackageSearch } from "lucide-react";
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
  "vault-withdrawal-saved": "Списание из сейфа сохранено.",
  "vault-withdrawal-required": "Укажите положительную сумму и комментарий.",
  "vault-withdrawal-over-balance": "Нельзя списать больше текущего остатка сейфа.",
  "vault-withdrawal-denied": "Списывать из сейфа может только супер-администратор.",
  "vault-withdrawal-error": "Не удалось выполнить списание из сейфа.",
  "vault-deposit-saved": "Пополнение сейфа сохранено.",
  "vault-deposit-required": "Укажите положительную сумму и комментарий.",
  "vault-deposit-denied": "Пополнять сейф может только управляющий или супер-администратор.",
  "vault-deposit-error": "Не удалось пополнить сейф.",
  "store-updated": "Магазин обновлён.",
  "employee-updated": "Сотрудник обновлён.",
  "employee-deleted": "Сотрудник удалён.",
  "employee-restored": "Сотрудник восстановлен.",
  "store-archived": "Магазин скрыт.",
  "store-restored": "Магазин восстановлен.",
  "admin-required": "Заполните обязательные поля.",
  "admin-error": "Что-то пошло не так.",
};

type VaultWithdrawalRow = { id: string; amount: number | string; comment: string; created_at: string };
type VaultDepositRow = { id: string; amount: number | string; comment: string; created_at: string };

function money(value: number | string) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value))} ₽`;
}

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
  const canManageVault = roles.includes("super_admin");
  const canDepositVault = canManageVault || roles.includes("store_manager");
  const [vaultBalanceResult, vaultWithdrawalsResult, vaultDepositsResult] = canDepositVault
    ? await Promise.all([
      supabase.rpc("get_vault_cash_balance"),
      canManageVault
        ? supabase.from("vault_cash_withdrawals").select("id, amount, comment, created_at").order("created_at", { ascending: false }).limit(10).returns<VaultWithdrawalRow[]>()
        : Promise.resolve({ data: [] as VaultWithdrawalRow[], error: null }),
      supabase.from("vault_cash_deposits").select("id, amount, comment, created_at").order("created_at", { ascending: false }).limit(10).returns<VaultDepositRow[]>(),
    ])
    : [{ data: null, error: null }, { data: [] as VaultWithdrawalRow[], error: null }, { data: [] as VaultDepositRow[], error: null }];

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

        {canDepositVault ? (
          <section className="mt-4 ui-panel p-4 shadow-soft">
            <SectionHeader icon={Banknote} title="Сейф" />
            {vaultBalanceResult.error ? <p className="mt-3 text-sm text-brand">Не удалось загрузить остаток сейфа.</p> : (
              <p className="mt-3 text-2xl font-semibold tabular-nums">{money(vaultBalanceResult.data ?? 0)}</p>
            )}
            <p className="mt-1 text-xs text-muted">Инкассации и ручные пополнения с 1 ноября 2026 года минус списания из сейфа.</p>
            <form action="/admin/vault/deposit" className="mt-4 grid gap-3 sm:grid-cols-[minmax(180px,0.5fr)_1fr_auto]" method="post">
              <label className="grid gap-1 text-sm">
                <span>Сумма, ₽</span>
                <input className="h-11 rounded-md border border-line bg-surface px-3" min="0.01" name="amount" required step="0.01" type="number" />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Комментарий</span>
                <input className="h-11 rounded-md border border-line bg-surface px-3" maxLength={1000} name="comment" required />
              </label>
              <div className="flex items-end"><button className="h-11 w-full rounded-md bg-brand px-4 font-semibold text-white sm:w-auto" type="submit">Внести</button></div>
            </form>
            {canManageVault ? (
              <form action="/admin/vault/withdraw" className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(180px,0.5fr)_1fr_auto]" method="post">
                <label className="grid gap-1 text-sm">
                  <span>Сумма списания, ₽</span>
                  <input className="h-11 rounded-md border border-line bg-surface px-3" max={vaultBalanceResult.data ?? undefined} min="0.01" name="amount" required step="0.01" type="number" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Комментарий</span>
                  <input className="h-11 rounded-md border border-line bg-surface px-3" maxLength={1000} name="comment" required />
                </label>
                <div className="flex items-end"><button className="h-11 w-full rounded-md border border-line px-4 font-semibold text-ink sm:w-auto" type="submit">Списать</button></div>
              </form>
            ) : null}
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Последние пополнения</h3>
              {vaultDepositsResult.error ? <p className="mt-2 text-sm text-brand">Не удалось загрузить историю пополнений.</p> : null}
              {!vaultDepositsResult.error && (vaultDepositsResult.data ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">Пополнений пока нет.</p> : null}
              <div className="mt-2 divide-y divide-line">
                {(vaultDepositsResult.data ?? []).map((deposit) => (
                  <div key={deposit.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words text-muted">{deposit.comment}<span className="mt-1 block text-xs">{new Date(deposit.created_at).toLocaleString("ru-RU")}</span></span>
                    <strong className="shrink-0">+{money(deposit.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
            {canManageVault ? <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Последние списания</h3>
              {vaultWithdrawalsResult.error ? <p className="mt-2 text-sm text-brand">Не удалось загрузить историю списаний.</p> : null}
              {!vaultWithdrawalsResult.error && (vaultWithdrawalsResult.data ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">Списаний пока нет.</p> : null}
              <div className="mt-2 divide-y divide-line">
                {(vaultWithdrawalsResult.data ?? []).map((withdrawal) => (
                  <div key={withdrawal.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words text-muted">{withdrawal.comment}<span className="mt-1 block text-xs">{new Date(withdrawal.created_at).toLocaleString("ru-RU")}</span></span>
                    <strong className="shrink-0">−{money(withdrawal.amount)}</strong>
                  </div>
                ))}
              </div>
            </div> : null}
          </section>
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












