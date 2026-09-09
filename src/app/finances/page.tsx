import { Banknote, ClipboardList, Gift, LayoutList, WalletCards } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const links = [
  { href: "/payroll", title: "Зарплата", description: "Расчёт и выплаты сотрудникам", icon: WalletCards },
  { href: "/finances?form=adjustments", title: "Премии и штрафы", description: "Корректировки зарплаты", icon: Gift },
  { href: "/finances?form=plan", title: "План на магазин", description: "Планы продаж по магазинам", icon: LayoutList },
  { href: "/cash", title: "Наличные в кассе", description: "Остатки, РКО и ПКО", icon: Banknote },
];

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default async function FinancesPage({ searchParams }: { searchParams: Promise<{ form?: string }> }) {
  const { form } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, [...MANAGE_ROLES, "auditor"])) redirect("/");
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const { data: employees } = accessibleStoreIds.length > 0
    ? await supabase
        .from("employees")
        .select("id, full_name, employee_store_assignments(store_id)")
        .eq("is_active", true)
        .order("full_name")
    : { data: [] };
  const accessibleEmployees = (employees ?? []).filter((employee: { employee_store_assignments?: { store_id: string }[] }) =>
    employee.employee_store_assignments?.some((assignment) => accessibleStoreIds.includes(assignment.store_id)),
  ) as { id: string; full_name: string }[];
  const { data: plans } = accessibleStoreIds.length > 0
    ? await supabase
        .from("store_sales_plans")
        .select("id, store_id, period_start, period_end, sales_plan_amount")
        .in("store_id", accessibleStoreIds)
        .order("period_start", { ascending: false })
        .limit(12)
    : { data: [] };
  const planByStoreAndMonth = new Map((plans ?? []).map((plan: { store_id: string; period_start: string; sales_plan_amount: number | string }) => [`${plan.store_id}_${plan.period_start}`, plan]));
  const month = currentMonth();

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={ClipboardList} title="Финансы" showBack />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {links.map(({ href, title, description, icon: Icon }) => (
            <Link key={title} className="ui-panel p-4 transition hover:border-brand/60" href={href}>
              <div className="flex items-center gap-3">
                <Icon className="text-brand" size={22} />
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-muted">{description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {form === "plan" ? <section className="mt-6 ui-panel p-4">
          <div id="store-plan">
            <h2 className="font-semibold">План на магазин</h2>
            <p className="mt-1 text-sm text-muted">Выставить или просмотреть план продаж по доступным магазинам.</p>
            <form action="/admin/store-plans/save" className="mt-4 grid gap-3" method="post">
              <select className="h-11 rounded-md border border-line px-3" name="store_id" required>
                <option value="">Выберите магазин</option>
                {accessibleStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
              <input className="h-11 rounded-md border border-line px-3" defaultValue={month} name="month" required type="month" />
              <input className="h-11 rounded-md border border-line px-3" min="0" name="sales_plan_amount" placeholder="Сумма плана" required step="0.01" type="number" />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Сохранить план</button>
            </form>
            <div className="mt-4 grid gap-2 text-sm">
              {accessibleStores.map((store) => {
                const plan = planByStoreAndMonth.get(`${store.id}_${month}-01`) as { sales_plan_amount?: number | string } | undefined;
                return <p key={store.id} className="flex justify-between gap-3 border-t border-line pt-2"><span>{store.name}</span><span className="font-semibold">{plan ? `${Number(plan.sales_plan_amount).toLocaleString("ru-RU")} руб.` : "Не задан"}</span></p>;
              })}
            </div>
          </div>
        </section> : null}

        {form === "adjustments" ? <section className="mt-6 ui-panel p-4">
          <div id="payroll-adjustments">
            <h2 className="font-semibold">Премии и штрафы</h2>
            <p className="mt-1 text-sm text-muted">Добавить премию, штраф или другую корректировку сотруднику.</p>
            <form action="/admin/payroll-adjustments/create" className="mt-4 grid gap-3" method="post">
              <input name="return_to" type="hidden" value="/finances" />
              <select className="h-11 rounded-md border border-line px-3" name="employee_id" required>
                <option value="">Выберите сотрудника</option>
                {accessibleEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
              </select>
              <input className="h-11 rounded-md border border-line px-3" defaultValue={month} name="month" required type="month" />
              <select className="h-11 rounded-md border border-line px-3" defaultValue="bonus" name="adjustment_type">
                <option value="bonus">Премия</option>
                <option value="fine">Штраф</option>
                <option value="advance">Аванс</option>
                <option value="inventory">Инвентарная корректировка</option>
                <option value="expiration">Просрочка</option>
                <option value="product">Корректировка под ЗП</option>
              </select>
              <input className="h-11 rounded-md border border-line px-3" min="0" name="amount" placeholder="Сумма" required step="0.01" type="number" />
              <textarea className="min-h-20 rounded-md border border-line px-3 py-2" name="reason" placeholder="Причина или комментарий" required />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Сохранить корректировку</button>
            </form>
          </div>
        </section> : null}
      </div>
      <BottomNav />
    </main>
  );
}
