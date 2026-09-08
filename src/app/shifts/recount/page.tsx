import { Banknote } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { CashRecountForm } from "@/components/cash-recount-form";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = { searchParams: Promise<{ storeId?: string; shiftId?: string; message?: string }> };

type PreviousCashCount = {
  coins_amount?: unknown;
  rows?: Array<{ denomination_id?: unknown; quantity?: unknown }>;
};

export default async function CashRecountPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  if (!employeeId || !roles.includes("manager")) redirect("/");

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, store_id, stores(name, city)")
    .eq("id", params.shiftId ?? "")
    .eq("opened_by_employee_id", employeeId)
    .in("status", ["opened", "correction_required"])
    .maybeSingle<{ id: string; store_id: string; stores: { name: string; city: string } | null }>();
  if (!shift || (params.storeId && params.storeId !== shift.store_id)) redirect("/");

  const { data: denominations, error } = await supabase
    .from("cash_denominations")
    .select("id, value")
    .eq("is_active", true)
    .gte("value", 1)
    .order("value", { ascending: false })
    .returns<{ id: string; value: number }[]>();
  if (error) throw new Error(error.message);

  const { data: previousCashCount } = await supabase
    .from("store_cash_counts")
    .select("denominations")
    .eq("store_id", shift.store_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ denominations: PreviousCashCount | null }>();

  const previousDenominations = previousCashCount?.denominations;
  const initialCounts = Object.fromEntries(
    (previousDenominations?.rows ?? [])
      .filter((row) => row.denomination_id != null && Number.isFinite(Number(row.quantity)) && Number(row.quantity) >= 0)
      .map((row) => [String(row.denomination_id), String(Math.floor(Number(row.quantity)))])
  );
  const initialCoins = Number.isFinite(Number(previousDenominations?.coins_amount)) && Number(previousDenominations?.coins_amount) >= 0
    ? String(previousDenominations?.coins_amount)
    : "";

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-2xl">
        <SectionHeader icon={Banknote} title="Пересчёт кассы" showBack />
        <section className="mt-4 ui-panel p-4">
          <p className="font-semibold">{shift.stores?.name ?? "Магазин"}</p>
          <p className="mt-1 text-sm text-muted">{shift.stores?.city ?? ""}</p>
          {params.message === "saved" ? <p className="mt-3 text-sm text-brand">Наличка в кассе обновлена.</p> : null}
          <CashRecountForm
            denominations={denominations ?? []}
            initialCoins={initialCoins}
            initialCounts={initialCounts}
            shiftId={shift.id}
            storeId={shift.store_id}
          />
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
