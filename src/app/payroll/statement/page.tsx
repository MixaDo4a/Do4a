import Link from "next/link";
import { redirect } from "next/navigation";
import { WalletCards } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { Metric } from "@/components/metric";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ period?: string; employeeId?: string }>;
};

type PayrollEntry = {
  employee_id: string;
  shift_count: number;
  gross_revenue: number;
  sales_pay_amount: number;
  plan_bonus_amount: number;
  checklist_salary_per_shift: number;
  base_salary_amount: number;
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

function money(value: number | string) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value))} руб.`;
}

export default async function PayrollStatementPage({ searchParams }: PageProps) {
  const { period, employeeId: requestedEmployeeId } = await searchParams;
  const month = period?.slice(0, 7) ?? currentMonth();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) redirect("/payroll");

  const { employeeId: currentEmployeeId } = await getCurrentEmployeeId();
  const managerOnly = roles.includes("manager") && !hasAnyRole(roles, ["store_manager", "super_admin", "developer"]);
  const { data: payrollPeriod } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("period_month", `${month}-01`)
    .maybeSingle<{ id: string }>();

  if (!payrollPeriod?.id || !requestedEmployeeId) redirect(`/payroll?period=${month}`);

  let entriesQuery = supabase
    .from("payroll_entries")
    .select(
      "employee_id, shift_count, gross_revenue, sales_pay_amount, plan_bonus_amount, checklist_salary_per_shift, base_salary_amount, advance_amount, expiration_writeoff_amount, inventory_loss_amount, product_writeoff_amount, total_payout_amount, employees(full_name, is_active)",
    )
    .eq("payroll_period_id", payrollPeriod.id)
    .eq("employee_id", requestedEmployeeId);

  if (managerOnly) {
    entriesQuery = currentEmployeeId ? entriesQuery.eq("employee_id", currentEmployeeId) : entriesQuery.eq("employee_id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: entry, error: entryError } = await entriesQuery.maybeSingle<PayrollEntry>();
  if (entryError) throw new Error(entryError.message);
  if (!entry || !entry.employees?.is_active) redirect(`/payroll?period=${month}`);

  const [{ data: adjustments, error: adjustmentsError }, { data: salesDetails, error: salesError }, { data: checklistDetails, error: checklistError }] = await Promise.all([
    supabase
      .from("payroll_adjustments")
      .select("id, employee_id, adjustment_type, amount, reason, created_at")
      .eq("period_month", `${month}-01`)
      .eq("employee_id", entry.employee_id)
      .order("created_at", { ascending: true })
      .returns<PayrollAdjustment[]>(),
    supabase
      .from("sales_metrics")
      .select("shift_id, gross_revenue, sales_percent, sales_pay_amount, shifts(shift_date, stores(name))")
      .eq("employee_id", entry.employee_id)
      .eq("period_month", `${month}-01`)
      .order("created_at", { ascending: true })
      .returns<SalesDetail[]>(),
    supabase
      .from("checklist_submissions")
      .select("id, submitted_at, salary_per_shift_amount, average_score, stores(name)")
      .eq("employee_id", entry.employee_id)
      .eq("period_month", `${month}-01`)
      .order("submitted_at", { ascending: true })
      .returns<ChecklistDetail[]>(),
  ]);

  if (adjustmentsError) throw new Error(adjustmentsError.message);
  if (salesError) throw new Error(salesError.message);
  if (checklistError) throw new Error(checklistError.message);

  const advanceAdjustments = (adjustments ?? [])
    .filter((row) => row.adjustment_type === "advance")
    .reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={WalletCards} title="Зарплатная ведомость" showBack />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Расчёт за {month}</p>
            <h1 className="mt-1 text-xl font-semibold">{entry.employees?.full_name ?? "Сотрудник"}</h1>
          </div>
          <Link className="rounded-md border border-line px-3 py-2 text-sm font-semibold" href={`/payroll?period=${month}`}>
            К зарплате
          </Link>
        </div>

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric icon={WalletCards} label="К выплате" value={money(Number(entry.total_payout_amount) - advanceAdjustments)} />
          <Metric icon={WalletCards} label="Оборот" value={money(entry.gross_revenue)} />
          <Metric icon={WalletCards} label="Смены" value={String(entry.shift_count)} />
        </section>

        <section className="mt-6 ui-panel p-4 shadow-soft">
          <div className="grid gap-6">
            <div>
              <h2 className="font-semibold">Начисления по сменам</h2>
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
              <h2 className="font-semibold">Оклад и план</h2>
              <div className="mt-2 grid gap-2 text-sm">
                <p className="flex justify-between border-b border-line pb-2"><span>Оклад за смены</span><span className="font-semibold">+{money(entry.base_salary_amount)}</span></p>
                <p className="flex justify-between border-b border-line pb-2"><span>Ставка за смену</span><span>{money(entry.checklist_salary_per_shift)}</span></p>
                <p className="flex justify-between border-b border-line pb-2"><span>Бонус за выполнение плана</span><span className="font-semibold">+{money(entry.plan_bonus_amount)}</span></p>
              </div>
              {(checklistDetails ?? []).length > 0 ? <div className="mt-2 grid gap-2 text-sm">{(checklistDetails ?? []).map((row) => <p key={row.id} className="flex justify-between border-b border-line pb-2"><span>{row.submitted_at.slice(0, 10)} · {row.stores?.name ?? "Магазин"} · чек-лист {Number(row.average_score).toFixed(2)}</span><span>Ставка {money(row.salary_per_shift_amount)}</span></p>)}</div> : null}
            </div>

            <div>
              <h2 className="font-semibold">Премии и вычеты</h2>
              <div className="mt-2 grid gap-2 text-sm">
                {(adjustments ?? []).map((row) => {
                  const isBonus = row.adjustment_type === "bonus";
                  return <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-line p-3"><span>{row.created_at.slice(0, 10)} · {adjustmentLabels[row.adjustment_type] ?? row.adjustment_type}<br /><span className="text-muted">{row.reason}</span></span><span className={isBonus ? "font-semibold text-emerald-600" : "font-semibold text-brand"}>{isBonus ? "+" : "-"}{money(row.amount)}</span></div>;
                })}
                <p className="flex justify-between border-b border-line pb-2"><span>Авансы по закрытию смен</span><span>-{money(entry.advance_amount)}</span></p>
                <p className="flex justify-between border-b border-line pb-2"><span>Просрочка</span><span>-{money(entry.expiration_writeoff_amount)}</span></p>
                <p className="flex justify-between border-b border-line pb-2"><span>Инвентарные потери</span><span>-{money(entry.inventory_loss_amount)}</span></p>
                <p className="flex justify-between border-b border-line pb-2"><span>Корректировки под ЗП</span><span>-{money(entry.product_writeoff_amount)}</span></p>
              </div>
            </div>
          </div>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
