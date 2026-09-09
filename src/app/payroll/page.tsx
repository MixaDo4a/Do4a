import { WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { Metric } from "@/components/metric";
import { PayrollMonthForm } from "@/components/payroll-month-form";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; period?: string; detail?: string; employeeId?: string }>;
};

type PayrollEntry = {
  id: string;
  employee_id: string;
  shift_count: number;
  gross_revenue: number;
  sales_pay_amount: number;
  plan_bonus_amount: number;
  checklist_salary_per_shift: number;
  base_salary_amount: number;
  manual_bonus_amount: number;
  advance_amount: number;
  expiration_writeoff_amount: number;
  inventory_loss_amount: number;
  product_writeoff_amount: number;
  total_payout_amount: number;
  employees: { full_name: string; is_active: boolean } | null;
};

type PayrollAdjustment = {
  id: string;
  employee_id: string;
  adjustment_type: string;
  amount: number | string;
  reason: string;
  created_at: string;
};

type SalesDetail = {
  shift_id: string;
  gross_revenue: number | string;
  sales_percent: number | string;
  sales_pay_amount: number | string;
  shifts: { shift_date: string; stores: { name: string } | null } | null;
};

type ChecklistDetail = {
  id: string;
  submitted_at: string;
  salary_per_shift_amount: number | string;
  average_score: number | string;
  stores: { name: string } | null;
};

type AdjustmentTotals = {
  bonus: number;
  fine: number;
  advance: number;
  inventory: number;
  expiration: number;
  product: number;
};

const messages: Record<string, string> = {
  "period-required": "Укажите месяц.",
  "calculate-error": "Не удалось пересчитать зарплату.",
  calculated: "Зарплата пересчитана.",
};

const adjustmentLabels: Record<string, string> = {
  bonus: "Премия",
  fine: "Штраф",
  advance: "Аванс",
  inventory: "Инвентаризация",
  expiration: "Просрочка",
  product: "Корректировка под ЗП",
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthStart(month: string) {
  return `${month}-01`;
}

function money(value: number | string) {
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Number(value))} руб.`;
}

function emptyAdjustmentTotals(): AdjustmentTotals {
  return {
    bonus: 0,
    fine: 0,
    advance: 0,
    inventory: 0,
    expiration: 0,
    product: 0,
  };
}

export default async function PayrollPage({ searchParams }: PageProps) {
  const { message, period, detail, employeeId: requestedEmployeeId } = await searchParams;
  const month = period?.slice(0, 7) ?? currentMonth();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  const managerOnly = roles.includes("manager") && !hasAnyRole(roles, ["store_manager", "super_admin", "developer"]);
  const canRecalculate = hasAnyRole(roles, MANAGE_ROLES);

  const { data: payrollPeriod } = await supabase
    .from("payroll_periods")
    .select("id, period_month")
    .eq("period_month", monthStart(month))
    .maybeSingle();

  let entriesQuery = payrollPeriod?.id
    ? supabase
        .from("payroll_entries")
        .select(
          "id, employee_id, shift_count, gross_revenue, sales_pay_amount, plan_bonus_amount, checklist_salary_per_shift, base_salary_amount, manual_bonus_amount, advance_amount, expiration_writeoff_amount, inventory_loss_amount, product_writeoff_amount, total_payout_amount, employees(full_name, is_active)",
        )
        .eq("payroll_period_id", payrollPeriod.id)
    : null;

  if (entriesQuery && managerOnly) {
    entriesQuery = employeeId ? entriesQuery.eq("employee_id", employeeId) : null;
  }

  const { data: entries, error } = entriesQuery
    ? await entriesQuery.order("total_payout_amount", { ascending: false }).returns<PayrollEntry[]>()
    : { data: [] as PayrollEntry[], error: null };

  if (error) {
    throw new Error(error.message);
  }

  const visibleEntries = entries.filter((entry) => entry.employees?.is_active === true);
  const visibleEmployeeIds = visibleEntries.map((entry) => entry.employee_id);
  const { data: adjustments, error: adjustmentsError } = visibleEmployeeIds.length > 0
    ? await supabase
        .from("payroll_adjustments")
        .select("id, employee_id, adjustment_type, amount, reason, created_at")
        .eq("period_month", monthStart(month))
        .in("employee_id", visibleEmployeeIds)
        .returns<PayrollAdjustment[]>()
    : { data: [] as PayrollAdjustment[], error: null };

  if (adjustmentsError) {
    throw new Error(adjustmentsError.message);
  }

  const selectedEmployeeId = requestedEmployeeId && visibleEmployeeIds.includes(requestedEmployeeId) ? requestedEmployeeId : null;
  const selectedEntry = selectedEmployeeId ? visibleEntries.find((entry) => entry.employee_id === selectedEmployeeId) ?? null : null;
  const [{ data: salesDetails }, { data: checklistDetails }] = selectedEmployeeId
    ? await Promise.all([
        supabase
          .from("sales_metrics")
          .select("shift_id, gross_revenue, sales_percent, sales_pay_amount, shifts(shift_date, stores(name))")
          .eq("employee_id", selectedEmployeeId)
          .eq("period_month", monthStart(month))
          .order("created_at", { ascending: true })
          .returns<SalesDetail[]>(),
        supabase
          .from("checklist_submissions")
          .select("id, submitted_at, salary_per_shift_amount, average_score, stores(name)")
          .eq("employee_id", selectedEmployeeId)
          .eq("period_month", monthStart(month))
          .order("submitted_at", { ascending: true })
          .returns<ChecklistDetail[]>(),
      ])
    : [{ data: [] as SalesDetail[] }, { data: [] as ChecklistDetail[] }];

  const adjustmentTotalsByEmployee = new Map<string, AdjustmentTotals>();
  adjustments.forEach((adjustment) => {
    const totals = adjustmentTotalsByEmployee.get(adjustment.employee_id) ?? emptyAdjustmentTotals();
    if (adjustment.adjustment_type in totals) {
      totals[adjustment.adjustment_type as keyof AdjustmentTotals] += Number(adjustment.amount);
    }
    adjustmentTotalsByEmployee.set(adjustment.employee_id, totals);
  });

  const total = visibleEntries.reduce((sum, row) => sum + Number(row.total_payout_amount), 0);
  const sales = visibleEntries.reduce((sum, row) => sum + Number(row.sales_pay_amount), 0);
  const manualDeductions = Array.from(adjustmentTotalsByEmployee.values()).reduce(
    (sum, row) => sum + row.fine + row.advance + row.inventory + row.expiration + row.product,
    0,
  );
  const deductions = visibleEntries.reduce(
    (sum, row) =>
      sum +
      Number(row.advance_amount) +
      Number(row.expiration_writeoff_amount) +
      Number(row.inventory_loss_amount) +
      Number(row.product_writeoff_amount),
    0,
  ) + manualDeductions;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={WalletCards} title="Зарплата" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        <PayrollMonthForm month={month} canRecalculate={canRecalculate} />

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric icon={WalletCards} label="К выплате" value={money(total)} />
          <Metric icon={WalletCards} label="Продажи" value={money(sales)} />
          <Metric icon={WalletCards} label="Удержания" value={money(deductions)} />
        </section>

        <section className="mt-6 grid gap-3">
          {visibleEntries.length === 0 ? (
            <div className="ui-panel p-4 text-sm text-muted shadow-soft">
              За выбранный месяц зарплата еще не рассчитана.
            </div>
          ) : (
            visibleEntries.map((entry) => {
              const adjustmentTotals = adjustmentTotalsByEmployee.get(entry.employee_id) ?? emptyAdjustmentTotals();
              const displayedPayout = Number(entry.total_payout_amount) - adjustmentTotals.advance;

              return (
              <Link key={entry.id} className="ui-panel block p-4 transition hover:border-brand/60" href={`/payroll?period=${month}&employeeId=${entry.employee_id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{entry.employees?.full_name ?? "Сотрудник"}</h2>
                    <p className="mt-1 text-sm text-muted">
                      Смен: {entry.shift_count} · Оборот: {money(entry.gross_revenue)}
                    </p>
                  </div>
                  <strong>{money(displayedPayout)}</strong>
                </div>

                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <span>Продажи: {money(entry.sales_pay_amount)}</span>
                  <span>План: {money(entry.plan_bonus_amount)}</span>
                  <span>Оклад за смену: {money(entry.checklist_salary_per_shift)}</span>
                  <span>Оклад: {money(entry.base_salary_amount)}</span>
                  <span>Премии: +{money(adjustmentTotals.bonus)}</span>
                  <span>Штрафы: -{money(adjustmentTotals.fine)}</span>
                  <span>Авансы: -{money(adjustmentTotals.advance)}</span>
                  <span>Корректировки инвенты: -{money(adjustmentTotals.inventory)}</span>
                  <span>Корректировки просрока: -{money(adjustmentTotals.expiration)}</span>
                  <span>Корректировки под ЗП: -{money(adjustmentTotals.product)}</span>
                  <span>Итого премии/вычеты: {money(entry.manual_bonus_amount)}</span>
                  <span>Авансы: -{money(entry.advance_amount)}</span>
                  <span>Просрок: -{money(entry.expiration_writeoff_amount)}</span>
                  <span>Инвента: -{money(entry.inventory_loss_amount)}</span>
                  <span>Под ЗП: -{money(entry.product_writeoff_amount)}</span>
                </div>
              </Link>
              );
            })
          )}
        </section>

        {selectedEntry ? (
          <section className="mt-6 ui-panel p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Зарплатная ведомость · {month}</p>
                <h2 className="mt-1 text-xl font-semibold">{selectedEntry.employees?.full_name ?? "Сотрудник"}</h2>
              </div>
              <Link className="rounded-md border border-line px-3 py-2 text-sm font-semibold" href={`/payroll?period=${month}`}>К списку</Link>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric icon={WalletCards} label="К выплате" value={money(Number(selectedEntry.total_payout_amount) - (adjustmentTotalsByEmployee.get(selectedEntry.employee_id)?.advance ?? 0))} />
              <Metric icon={WalletCards} label="Оборот" value={money(selectedEntry.gross_revenue)} />
              <Metric icon={WalletCards} label="Смены" value={String(selectedEntry.shift_count)} />
            </div>

            <div className="mt-6 grid gap-4">
              <div>
                <h3 className="font-semibold">Начисления по сменам</h3>
                <div className="mt-2 grid gap-2">
                  {(salesDetails ?? []).length === 0 ? <p className="text-sm text-muted">Данных по продажам за период нет.</p> : (salesDetails ?? []).map((row) => (
                    <div key={row.shift_id} className="rounded-md border border-line p-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2 font-semibold">
                        <span>{row.shifts?.shift_date ?? "Дата не указана"} · {row.shifts?.stores?.name ?? "Магазин"}</span>
                        <span>+{money(row.sales_pay_amount)}</span>
                      </div>
                      <p className="mt-1 text-muted">Продажи: {money(row.gross_revenue)} · Процент: {Number(row.sales_percent).toLocaleString("ru-RU")} %</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold">Оклад и план</h3>
                <div className="mt-2 grid gap-2 text-sm">
                  <p className="flex justify-between border-b border-line pb-2"><span>Оклад за смены</span><span className="font-semibold">+{money(selectedEntry.base_salary_amount)}</span></p>
                  <p className="flex justify-between border-b border-line pb-2"><span>Ставка за смену</span><span>{money(selectedEntry.checklist_salary_per_shift)}</span></p>
                  <p className="flex justify-between border-b border-line pb-2"><span>Бонус за выполнение плана</span><span className="font-semibold">+{money(selectedEntry.plan_bonus_amount)}</span></p>
                </div>
                {(checklistDetails ?? []).length > 0 ? <div className="mt-2 grid gap-2 text-sm">{(checklistDetails ?? []).map((row) => <p key={row.id} className="flex justify-between border-b border-line pb-2"><span>{row.submitted_at.slice(0, 10)} · {row.stores?.name ?? "Магазин"} · чек-лист {Number(row.average_score).toFixed(2)}</span><span>Ставка {money(row.salary_per_shift_amount)}</span></p>)}</div> : null}
              </div>

              <div>
                <h3 className="font-semibold">Премии и вычеты</h3>
                <div className="mt-2 grid gap-2 text-sm">
                  {adjustments.filter((row) => row.employee_id === selectedEmployeeId).map((row) => {
                    const isBonus = row.adjustment_type === "bonus";
                    return <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-line p-3"><span>{row.created_at.slice(0, 10)} · {adjustmentLabels[row.adjustment_type] ?? row.adjustment_type}<br /><span className="text-muted">{row.reason}</span></span><span className={isBonus ? "font-semibold text-emerald-600" : "font-semibold text-brand"}>{isBonus ? "+" : "-"}{money(row.amount)}</span></div>;
                  })}
                  <p className="flex justify-between border-b border-line pb-2"><span>Авансы по закрытию смен</span><span>-{money(selectedEntry.advance_amount)}</span></p>
                  <p className="flex justify-between border-b border-line pb-2"><span>Просрочка</span><span>-{money(selectedEntry.expiration_writeoff_amount)}</span></p>
                  <p className="flex justify-between border-b border-line pb-2"><span>Инвентарные потери</span><span>-{money(selectedEntry.inventory_loss_amount)}</span></p>
                  <p className="flex justify-between border-b border-line pb-2"><span>Корректировки под ЗП</span><span>-{money(selectedEntry.product_writeoff_amount)}</span></p>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}



