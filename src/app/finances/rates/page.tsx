import { WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import { AcademyRateForm, type AcademyRateInput } from "@/components/academy-rate-form";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AcademyRateRow = AcademyRateInput & {
  id: number;
  reason: string;
  created_at: string;
};

const money = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export default async function AcademyRatesPage({ searchParams }: { searchParams: Promise<{ message?: string; detail?: string }> }) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["super_admin", "developer"])) redirect("/finances");

  const { data, error } = await supabase
    .from("academy_pay_rates")
    .select("id, level, effective_from, hourly_rate, base_commission_percent, plan_commission_percent, reason, created_at")
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);

  const history = (data ?? []) as AcademyRateRow[];
  const latest = new Map<number, AcademyRateRow>();
  for (const rate of history) if (!latest.has(rate.level)) latest.set(rate.level, rate);
  const current = Array.from({ length: 10 }, (_, index) => latest.get(index + 1)).filter((rate): rate is AcademyRateRow => Boolean(rate));

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={WalletCards} title="Ставки по уровням" showBack />
        {message === "saved" ? <p className="mt-4 ui-panel p-3 text-sm">Ставка сохранена.</p> : null}
        {message === "error" ? <p className="mt-4 ui-panel p-3 text-sm text-brand">{detail ?? "Не удалось сохранить ставку."}</p> : null}

        <section className="mt-4 ui-panel p-4">
          <h2 className="font-semibold">Изменить ставку</h2>
          <AcademyRateForm rates={current} />
        </section>

        <section className="mt-6">
          <h2 className="font-semibold">Последние установленные ставки</h2>
          <div className="mt-3 divide-y divide-line border-y border-line text-sm">
            {current.map((rate) => (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3" key={rate.level}>
                <span className="font-semibold">LVL{rate.level}</span>
                <span>{money(Number(rate.hourly_rate))} руб./ч</span>
                <span>{Number(rate.base_commission_percent)}%{rate.level >= 5 ? ` / ${Number(rate.plan_commission_percent)}%` : ""}</span>
                <span className="text-muted">с {rate.effective_from}</span>
              </div>
            ))}
          </div>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-semibold">История изменений</summary>
            <div className="mt-3 divide-y divide-line border-y border-line">
              {history.map((rate) => (
                <div className="py-3" key={rate.id}>
                  <p className="font-semibold">LVL{rate.level} · с {rate.effective_from} · {money(Number(rate.hourly_rate))} руб./ч · {Number(rate.base_commission_percent)}% / {Number(rate.plan_commission_percent)}%</p>
                  <p className="mt-1 text-muted">{rate.reason}</p>
                </div>
              ))}
            </div>
          </details>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
