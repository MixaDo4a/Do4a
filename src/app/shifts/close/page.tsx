import { ReceiptText, Save } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PhotoFileInput } from "@/components/photo-file-input";
import { SectionHeader } from "@/components/section-header";
import { ShiftCloseFields } from "@/components/shift-close-fields";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CloseShiftPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

type Denomination = {
  id: string;
  value: number;
  kind: "banknote" | "coin" | "bag";
};

type ShiftOption = {
  id: string;
  shift_date: string;
  store_id: string;
  stores: { id: string; name: string; city: string | null } | null;
  shift_participants: {
    participant_role: "primary_seller" | "secondary_seller";
    employees: { full_name: string } | null;
  }[];
};

type StoreCashCount = { store_id: string; created_at: string; denominations: { coins_amount?: unknown } | null };

const messages: Record<string, string> = {
  "shift-required": "Выберите смену.",
  "photo-required": "Смена не может быть закрыта: добавьте фото Z-отчёта.",
  "cash-comment-required": "Смена не может быть закрыта: укажите комментарий к инкассации.",
  "cash-counts-required": "Смена не может быть закрыта: заполните покупюрник полностью.",
  "cash-count-save-error": "Не удалось сохранить пересчёт наличности с мелочью. Смена не закрыта; проверьте доступ и повторите попытку.",
  "advance-recipient-required": "Выберите менеджера, которому выдан аванс.",
  "number-error": "Проверьте числовые поля: суммы должны быть в допустимом диапазоне.",
  "close-error": "Не удалось закрыть смену. Проверьте данные или права доступа.",
  "photo-error": "Смена закрыта, но фото отчёта не сохранилось.",
};

const COUNT_INPUT_MAX = "999999";

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

export default async function CloseShiftPage({ searchParams }: CloseShiftPageProps) {
  const params = await searchParams;
  const { message, shiftId, detail, hideCash } = params;
  const messageText = message ? messages[message] : null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));
  const compactClose = managerOnly && hideCash === "1";

  const [denominationsResult, shiftsResult] = await Promise.all([
    supabase
      .from("cash_denominations")
      .select("id, value, kind")
      .eq("is_active", true)
      .order("value", { ascending: false })
      .returns<Denomination[]>(),
    (() => {
      let query = supabase
        .from("shifts")
        .select("id, shift_date, store_id, stores(id, name, city), shift_participants(participant_role, employees(full_name))")
        .in("status", ["opened", "correction_required"])
        .order("shift_date", { ascending: false });
      if (managerOnly && employeeId) query = query.eq("opened_by_employee_id", employeeId);
      return query.returns<ShiftOption[]>();
    })(),
  ]);

  if (denominationsResult.error) {
    throw new Error(denominationsResult.error.message);
  }

  if (shiftsResult.error) {
    throw new Error(shiftsResult.error.message);
  }

  const selectedShiftId = shiftId ?? shiftsResult.data[0]?.id ?? "";
  const storeIds = [...new Set(shiftsResult.data.map((shift) => shift.store_id))];
  const cashCountResults = await Promise.all(storeIds.map((storeId) => supabase.from("store_cash_counts")
    .select("store_id, created_at, denominations")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<StoreCashCount>()));
  const cashCountError = cashCountResults.find((result) => result.error)?.error;
  if (cashCountError) throw new Error(cashCountError.message);
  const coinsByStore: Record<string, string> = {};
  for (const { data: cashCount } of cashCountResults) {
    if (!cashCount) continue;
    const amount = Number(cashCount.denominations?.coins_amount ?? 0);
    if (Number.isFinite(amount) && amount >= 0) coinsByStore[cashCount.store_id] = String(amount);
  }
  const cityShiftPairs = new Map<string, string>();
  for (const shift of shiftsResult.data) {
    const key = shift.stores?.city?.trim().toLocaleLowerCase("ru-RU") ?? "";
    if (key && !cityShiftPairs.has(key)) cityShiftPairs.set(key, shift.id);
  }
  const managerResults = await Promise.all([...cityShiftPairs].map(async ([city, representativeShiftId]) => {
    const { data, error } = await supabase.rpc("list_city_managers_for_shift", { p_shift_id: representativeShiftId });
    if (error) throw new Error(error.message);
    return [city, data ?? []] as const;
  }));
  const managersByCity = Object.fromEntries(managerResults);

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={ReceiptText} title="Закрытие смены" showBack />
        {messageText ? (
          <p className="mt-4 ui-panel p-3 text-sm text-danger">
            {messageText}
            {detail ? <span className="mt-1 block text-xs text-muted">Причина: {detail}</span> : null}
          </p>
        ) : null}

        <form action="/shifts/close/submit" className="mt-4 grid gap-4" encType="multipart/form-data" method="post">
          {compactClose ? <input name="hide_cash" type="hidden" value="1" /> : null}
          <ShiftCloseFields
            coinsByStore={coinsByStore}
            managersByCity={managersByCity}
            params={params}
            selectedShiftId={selectedShiftId}
            shifts={shiftsResult.data}
          />

          {!compactClose ? <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Покупюрник</h2>
            <div className="mt-4 grid gap-2">
              {denominationsResult.data.filter((denomination) => denomination.value >= 1 && denomination.value !== 3).map((denomination) => (
                <label key={denomination.id} className="grid grid-cols-[72px_1fr_96px] items-center gap-2 text-sm">
                  <span>{formatMoney(denomination.value)}</span>
                  <input
                    name={`denomination_${denomination.value}`}
                    className="h-10 rounded-md border border-line px-3 outline-none focus:border-brand"
                    defaultValue={params[`denomination_${denomination.value}`] ?? ""}
                    inputMode="numeric"
                    max={COUNT_INPUT_MAX}
                    min="0"
                    required
                    step="1"
                    type="number"
                  />
                  <input name={`denomination_id_${denomination.value}`} type="hidden" value={denomination.id} />
                  <span className="text-right text-muted">шт.</span>
                </label>
              ))}
            </div>
          </section> : null}

          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Отчёт ККМ</h2>
            <PhotoFileInput name="kkm_report_photo" />
          </section>

          <button className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white">
            <Save size={18} /> Закрыть смену
          </button>
        </form>
      </div>
      <BottomNav />
    </main>
  );
}
