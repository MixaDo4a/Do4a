import { WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { Metric } from "@/components/metric";
import { PayrollMonthForm } from "@/components/payroll-month-form";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; period?: string; detail?: string }>;
};

type PayrollEntry = {
  id: string;
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

const messages: Record<string, string> = {
  "period-required": "Укажите месяц.",
  "calculate-error": "Не удалось пересчитать зарплату.",
  calculated: "Зарплата пересчитана.",
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

export default async function PayrollPage({ searchParams }: PageProps) {
  const { message, period, detail } = await searchParams;
  const month = period?.slice(0, 7) ?? currentMonth();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  const canRecalculate = hasAnyRole(roles, MANAGE_ROLES);

  const { data: payrollPeriod } = await supabase
    .from("payroll_periods")
    .select("id, period_month")
    .eq("period_month", monthStart(month))
    .maybeSingle();

  const { data: entries, error } = payrollPeriod?.id
    ? await supabase
        .from("payroll_entries")
        .select(
          "id, shift_count, gross_revenue, sales_pay_amount, plan_bonus_amount, checklist_salary_per_shift, base_salary_amount, manual_bonus_amount, advance_amount, expiration_writeoff_amount, inventory_loss_amount, product_writeoff_amount, total_payout_amount, employees(full_name, is_active)",
        )
        .eq("payroll_period_id", payrollPeriod.id)
        .order("total_payout_amount", { ascending: false })
        .returns<PayrollEntry[]>()
    : { data: [], error: null };

  if (error) {
    throw new Error(error.message);
  }

  const visibleEntries = entries.filter((entry) => entry.employees?.is_active === true);
  const total = visibleEntries.reduce((sum, row) => sum + Number(row.total_payout_amount), 0);
  const sales = visibleEntries.reduce((sum, row) => sum + Number(row.sales_pay_amount), 0);
  const deductions = visibleEntries.reduce(
    (sum, row) =>
      sum +
      Number(row.advance_amount) +
      Number(row.expiration_writeoff_amount) +
      Number(row.inventory_loss_amount) +
      Number(row.product_writeoff_amount),
    0,
  );

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
            visibleEntries.map((entry) => (
              <article key={entry.id} className="ui-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{entry.employees?.full_name ?? "Сотрудник"}</h2>
                    <p className="mt-1 text-sm text-muted">
                      Смен: {entry.shift_count} · Оборот: {money(entry.gross_revenue)}
                    </p>
                  </div>
                  <strong>{money(entry.total_payout_amount)}</strong>
                </div>

                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <span>Продажи: {money(entry.sales_pay_amount)}</span>
                  <span>План: {money(entry.plan_bonus_amount)}</span>
                  <span>Оклад за смену: {money(entry.checklist_salary_per_shift)}</span>
                  <span>Оклад: {money(entry.base_salary_amount)}</span>
                  <span>Премии/штрафы: {money(entry.manual_bonus_amount)}</span>
                  <span>Авансы: -{money(entry.advance_amount)}</span>
                  <span>Просрок: -{money(entry.expiration_writeoff_amount)}</span>
                  <span>Инвента: -{money(entry.inventory_loss_amount)}</span>
                  <span>Под ЗП: -{money(entry.product_writeoff_amount)}</span>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}



