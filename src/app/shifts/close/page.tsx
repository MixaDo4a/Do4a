import { ReceiptText, Save } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PhotoFileInput } from "@/components/photo-file-input";
import { SectionHeader } from "@/components/section-header";
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
  stores: { name: string } | null;
  shift_participants: {
    participant_role: "primary_seller" | "secondary_seller";
    employees: { full_name: string } | null;
  }[];
};

const messages: Record<string, string> = {
  "shift-required": "Выберите смену.",
  "photo-required": "Смена не может быть закрыта: добавьте фото Z-отчёта.",
  "cash-comment-required": "Смена не может быть закрыта: укажите комментарий к инкассации.",
  "cash-counts-required": "Смена не может быть закрыта: заполните покупюрник полностью.",
  "number-error": "Проверьте числовые поля: суммы должны быть в допустимом диапазоне.",
  "close-error": "Не удалось закрыть смену. Проверьте данные или права доступа.",
  "photo-error": "Смена закрыта, но фото отчёта не сохранилось.",
};

const MONEY_INPUT_MAX = "999999999999.99";
const COUNT_INPUT_MAX = "999999";

const cashFields = [
  ["cash_revenue", "Выручка наличными"],
  ["card_revenue", "Выручка безналом"],
  ["cash_returns", "Возвраты наличными"],
  ["card_returns", "Возвраты безналом"],
  ["receipt_count", "Количество чеков"],
  ["items_sold_count", "Количество товаров"],
  ["cash_collection_amount", "Инкассация"],
  ["advance_amount", "Аванс"],
] as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

function formatShiftDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function formatShiftOption(shift: ShiftOption) {
  const primarySeller = shift.shift_participants.find(
    (participant) => participant.participant_role === "primary_seller",
  );

  return [
    shift.stores?.name ?? "Магазин не найден",
    formatShiftDate(shift.shift_date),
    primarySeller?.employees?.full_name ? `основной: ${primarySeller.employees.full_name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

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

  const [denominationsResult, shiftsResult] = await Promise.all([
    supabase
      .from("cash_denominations")
      .select("id, value, kind")
      .eq("is_active", true)
      .order("value", { ascending: false })
      .returns<Denomination[]>(),
    supabase
      .from("shifts")
      .select("id, shift_date, stores(name), shift_participants(participant_role, employees(full_name))")
      .in("status", ["opened", "correction_required"])
      .order("shift_date", { ascending: false })
      .returns<ShiftOption[]>(),
  ]);

  if (denominationsResult.error) {
    throw new Error(denominationsResult.error.message);
  }

  if (shiftsResult.error) {
    throw new Error(shiftsResult.error.message);
  }

  const selectedShiftId = shiftId ?? shiftsResult.data[0]?.id ?? "";

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
          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Смена</h2>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="text-muted">Открытая смена</span>
              <select className="h-11 ui-panel px-3 outline-none focus:border-brand" defaultValue={selectedShiftId} name="shift_id" required>
                {shiftsResult.data.length === 0 ? (
                  <option value="">Нет открытых смен</option>
                ) : (
                  shiftsResult.data.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {formatShiftOption(shift)}
                    </option>
                  ))
                )}
              </select>
            </label>
          </section>

          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Касса</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cashFields.map(([name, label]) => {
                const isCount = name === "receipt_count" || name === "items_sold_count";

                return (
                  <label key={name} className="grid gap-1 text-sm">
                    <span className="text-muted">{label}</span>
                    <input
                      className="h-11 ui-panel px-3 outline-none focus:border-brand"
                      defaultValue={params[name] ?? ""}
                      inputMode={isCount ? "numeric" : "decimal"}
                      max={isCount ? COUNT_INPUT_MAX : MONEY_INPUT_MAX}
                      min="0"
                      name={name}
                      step={isCount ? "1" : "0.01"}
                      type="number"
                    />
                  </label>
                );
              })}
            </div>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="text-muted">Комментарий к выемке / РКО</span>
              <textarea
                className="min-h-20 ui-panel px-3 py-2 outline-none focus:border-brand"
                defaultValue={params.cash_collection_comment ?? ""}
                name="cash_collection_comment"
              />
            </label>
          </section>

          <section className="ui-panel p-4">
            <h2 className="text-base font-semibold">Покупюрник</h2>
            <div className="mt-4 grid gap-2">
              {denominationsResult.data.map((denomination) => (
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
          </section>

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
