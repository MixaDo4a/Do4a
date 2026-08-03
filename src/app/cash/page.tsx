import { Banknote, CircleDollarSign } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { buildStoreCashBalances, type StoreCashShiftRow } from "@/lib/cash";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string }>;
};

type MovementRow = {
  id: string;
  store_id: string;
  movement_type: "rko" | "pko";
  amount: number | string;
  comment: string;
  created_at: string;
  stores: { name: string; city: string } | null;
};

const viewRoles = ["manager", "auditor", "store_manager", "super_admin", "developer", "warehouse_manager"];
const manageRoles = ["super_admin", "developer"];

const messages: Record<string, string> = {
  required: "Заполните обязательные поля.",
  saved: "Операция сохранена.",
  "save-error": "Не удалось сохранить данные.",
};

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} руб.`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function CashPage({ searchParams }: PageProps) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, viewRoles)) {
    redirect("/");
  }

  const canManageMovements = hasAnyRole(roles, manageRoles);
  const stores = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);

  const [shiftsResult, movementsResult] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from("shifts")
          .select(
            "id, store_id, shift_date, closed_at, status, stores(id, name, city), shift_closing_reports(cash_collection_amount, shift_cash_counts(line_amount))",
          )
          .in("store_id", storeIds)
          .in("status", ["closed", "auto_closed"])
          .order("closed_at", { ascending: false, nullsFirst: false })
          .limit(150)
          .returns<StoreCashShiftRow[]>()
      : Promise.resolve({ data: [] as StoreCashShiftRow[], error: null }),
    storeIds.length > 0
      ? supabase
          .from("store_cash_movements")
          .select("id, store_id, movement_type, amount, comment, created_at, stores(name, city)")
          .in("store_id", storeIds)
          .order("created_at", { ascending: false })
          .limit(100)
          .returns<MovementRow[]>()
      : Promise.resolve({ data: [] as MovementRow[], error: null }),
  ]);

  if (shiftsResult.error) {
    throw new Error(shiftsResult.error.message);
  }

  if (movementsResult.error) {
    throw new Error(movementsResult.error.message);
  }

  const balances = buildStoreCashBalances(shiftsResult.data);
  const movements = movementsResult.data;
  const totalBalance = balances.reduce((sum, item) => sum + item.balance, 0);

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Banknote} title="Наличка в кассах" showBack />

        {message ? (
          <div className="mt-4 ui-panel p-3 text-sm text-muted">
            <p className="font-semibold text-ink">{messages[message] ?? message}</p>
            {detail ? <p className="mt-1 break-words text-xs text-brand">{detail}</p> : null}
          </div>
        ) : null}

        <section className="mt-4 ui-panel p-4 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted">Общий остаток по доступным магазинам</p>
              <p className="mt-1 text-2xl font-semibold">{money(totalBalance)}</p>
            </div>
            <div className="rounded-2xl border border-line/70 bg-[#0d090a]/92 px-3 py-2 text-sm text-muted">
              Данные собраны по последним закрытым сменам и кассовым движениям
            </div>
          </div>
        </section>

        {canManageMovements ? (
          <section className="mt-4 ui-panel p-4 shadow-soft">
            <SectionHeader icon={CircleDollarSign} title="РКО / ПКО" />
            <form action="/cash/movement/create" className="mt-4 grid gap-3 sm:grid-cols-2" method="post">
              <select className="h-11 rounded-md border border-line px-3" name="store_id" required>
                <option value="">Магазин</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}, {store.city}
                  </option>
                ))}
              </select>
              <select className="h-11 rounded-md border border-line px-3" name="movement_type" required>
                <option value="rko">РКО</option>
                <option value="pko">ПКО</option>
              </select>
              <input className="h-11 rounded-md border border-line px-3" min="0.01" name="amount" placeholder="Сумма" step="0.01" type="number" required />
              <input className="h-11 rounded-md border border-line px-3 sm:col-span-2" name="comment" placeholder="Комментарий" required />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white sm:col-span-2">Сохранить движение</button>
            </form>
          </section>
        ) : null}

        <section className="mt-4 grid gap-4">
          {balances.length === 0 ? (
            <p className="ui-panel p-4 text-sm text-muted">По доступным магазинам пока нет кассовых данных.</p>
          ) : (
            balances.map((item) => {
              const storeMovements = movements.filter((movement) => movement.store_id === item.storeId);

              return (
                <article key={item.storeId} className="ui-panel p-4 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{item.storeName}</p>
                      <p className="text-sm text-muted">{item.city}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted">Наличка в кассе</p>
                      <p className="text-xl font-semibold">{money(item.balance)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3">
                      <p className="text-xs text-muted">Последняя закрытая смена</p>
                      <p className="mt-1 text-sm font-semibold">{formatDateTime(item.lastClosedAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3">
                      <p className="text-xs text-muted">Сумма по покупюрнику</p>
                      <p className="mt-1 text-sm font-semibold">{money(item.latestReportTotal)}</p>
                    </div>
                    <div className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3">
                      <p className="text-xs text-muted">Инкассации и ПКО/РКО</p>
                      <p className="mt-1 text-sm font-semibold">{money(item.totalCollectionAmount)}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm font-semibold">Движения</p>
                    <div className="mt-2 grid gap-2">
                      {storeMovements.length === 0 ? (
                        <p className="text-sm text-muted">Движений пока нет.</p>
                      ) : (
                        storeMovements.slice(0, 5).map((movement) => (
                          <div key={movement.id} className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3 text-sm">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-medium">{movement.movement_type === "rko" ? "РКО" : "ПКО"}</p>
                              <p className="font-semibold">{money(Number(movement.amount))}</p>
                            </div>
                            <p className="mt-1 break-words text-muted">{movement.comment}</p>
                            <p className="mt-1 text-xs text-muted">{formatDateTime(movement.created_at)}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
