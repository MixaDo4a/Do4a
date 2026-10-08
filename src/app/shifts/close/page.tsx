import { ReceiptText } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PhotoFileInput } from "@/components/photo-file-input";
import { SectionHeader } from "@/components/section-header";
import { ShiftCloseFields, ShiftCloseSubmitButton } from "@/components/shift-close-fields";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { isShiftOverdue } from "@/lib/shift-overdue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CloseShiftPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
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

type StoreCashCount = { store_id: string; counted_amount: number | string };

const messages: Record<string, string> = {
  "shift-required": "Выберите смену.",
  "photo-required": "Смена не может быть закрыта: добавьте фото Z-отчёта.",
  "cash-comment-required": "Смена не может быть закрыта: укажите комментарий к инкассации.",
  "cash-counts-required": "Смена не закрыта: сначала сохраните пересчёт в покупюрнике.",
  "cash-count-save-error": "Не удалось получить последний покупюрник. Смена не закрыта; повторите попытку.",
  "actual-cash-required": "Укажите фактическую сумму наличных в кассе.",
  "cash-balance-mismatch": "Сумма наличных в кассе и сумма в покупюрнике не равна. Смена не закрыта, управляющие уведомлены.",
  "cash-balance-mismatch-notify-error": "Сумма наличных в кассе и сумма в покупюрнике не равна. Смена не закрыта, но уведомить управляющих не удалось.",
  "advance-recipient-required": "Выберите менеджера, которому выдан аванс.",
  "number-error": "Проверьте числовые поля: суммы должны быть в допустимом диапазоне.",
  "close-error": "Не удалось закрыть смену. Проверьте данные или права доступа.",
  "photo-error": "Смена закрыта, но фото отчёта не сохранилось.",
};

export default async function CloseShiftPage({ searchParams }: CloseShiftPageProps) {
  const params = await searchParams;
  const { message, shiftId, detail } = params;
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
  const overdueMode = params.overdue === "1";
  const canOverride = roles.some((role) => ["store_manager", "super_admin"].includes(role));
  if (overdueMode && (!canOverride || !shiftId)) redirect("/shifts");
  const allowedStoreIds = overdueMode ? (await getAccessibleStores(supabase)).map((store) => store.id) : [];

  const shiftsResult = await (() => {
      let query = supabase
        .from("shifts")
        .select("id, shift_date, store_id, stores(id, name, city), shift_participants(participant_role, employees(full_name))")
        .in("status", ["opened", "correction_required"])
        .order("shift_date", { ascending: false });
      if (overdueMode) query = query.eq("id", shiftId!).in("store_id", allowedStoreIds.length ? allowedStoreIds : ["00000000-0000-0000-0000-000000000000"]);
      if (roles.includes("manager") && !canOverride && employeeId) query = query.eq("opened_by_employee_id", employeeId);
      return query.returns<ShiftOption[]>();
    })();

  if (shiftsResult.error) {
    throw new Error(shiftsResult.error.message);
  }

  if (overdueMode) {
    const selected = shiftsResult.data[0];
    if (!selected) redirect("/shifts");
    const { data: deadline } = await supabase.from("shifts")
      .select("shift_date, schedules(planned_end_at), stores(timezone)")
      .eq("id", selected.id)
      .single<{ shift_date: string; schedules: { planned_end_at: string } | null; stores: { timezone: string | null } | null }>();
    if (!deadline || !isShiftOverdue(deadline)) redirect("/shifts");
  }

  const selectedShiftId = shiftId ?? shiftsResult.data[0]?.id ?? "";
  const storeIds = [...new Set(shiftsResult.data.map((shift) => shift.store_id))];
  const cashCountResults = await Promise.all(storeIds.map((storeId) => supabase.from("store_cash_counts")
    .select("store_id, counted_amount")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<StoreCashCount>()));
  const cashCountError = cashCountResults.find((result) => result.error)?.error;
  if (cashCountError) throw new Error(cashCountError.message);
  const latestCashByStore: Record<string, number> = {};
  for (const { data: cashCount } of cashCountResults) {
    if (!cashCount) continue;
    const amount = Number(cashCount.counted_amount);
    if (Number.isFinite(amount) && amount >= 0) latestCashByStore[cashCount.store_id] = amount;
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
          {overdueMode ? <>
            <input name="overdue_override" type="hidden" value="1" />
            <p className="ui-panel p-3 text-sm text-ink">Вы закрываете просроченную смену за сотрудника. Сумма наличных по Z-отчёту должна совпасть с последним покупюрником. При расхождении смена не закроется, управляющие получат уведомление.</p>
          </> : null}
          <ShiftCloseFields
            latestCashByStore={latestCashByStore}
            managersByCity={managersByCity}
            params={params}
            selectedShiftId={selectedShiftId}
            shifts={shiftsResult.data}
            lockShift={overdueMode}
          />

          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Отчёт ККМ</h2>
            <PhotoFileInput name="kkm_report_photo" />
          </section>

          <ShiftCloseSubmitButton />
        </form>
      </div>
      <BottomNav />
    </main>
  );
}
