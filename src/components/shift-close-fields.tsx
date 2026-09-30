"use client";

import { useState } from "react";

type ShiftCloseOption = {
  id: string;
  shift_date: string;
  stores: { name: string; city: string | null } | null;
  shift_participants: {
    participant_role: "primary_seller" | "secondary_seller";
    employees: { full_name: string } | null;
  }[];
};

type ManagerOption = { employee_id: string; full_name: string };

type Props = {
  shifts: ShiftCloseOption[];
  managersByCity: Record<string, ManagerOption[]>;
  selectedShiftId: string;
  params: Record<string, string | undefined>;
};

const cashFields = [
  ["cash_revenue", "Выручка наличными"],
  ["card_revenue", "Выручка безналом"],
  ["cash_returns", "Возвраты наличными"],
  ["card_returns", "Возвраты безналом"],
  ["receipt_count", "Количество чеков"],
  ["items_sold_count", "Количество товаров"],
  ["cash_collection_amount", "Инкассация"],
] as const;

const MONEY_INPUT_MAX = "999999999999.99";
const COUNT_INPUT_MAX = "999999";
const cityKey = (city: string | null | undefined) => city?.trim().toLocaleLowerCase("ru-RU") ?? "";

function formatShiftDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value));
}

function formatShiftOption(shift: ShiftCloseOption) {
  const primarySeller = shift.shift_participants.find((participant) => participant.participant_role === "primary_seller");
  return [
    shift.stores?.name ?? "Магазин не найден",
    formatShiftDate(shift.shift_date),
    primarySeller?.employees?.full_name ? `основной: ${primarySeller.employees.full_name}` : null,
  ].filter(Boolean).join(" · ");
}

export function ShiftCloseFields({ shifts, managersByCity, selectedShiftId, params }: Props) {
  const [shiftId, setShiftId] = useState(selectedShiftId);
  const [advanceAmount, setAdvanceAmount] = useState(params.advance_amount ?? "");
  const [recipientId, setRecipientId] = useState(params.advance_employee_id ?? "");
  const selectedShift = shifts.find((shift) => shift.id === shiftId);
  const cityManagers = managersByCity[cityKey(selectedShift?.stores?.city)] ?? [];
  const requiresRecipient = Number(advanceAmount.replace(",", ".")) > 0;

  return (
    <>
      <section className="ui-panel p-4">
        <h2 className="text-base font-semibold">Смена</h2>
        <label className="mt-4 grid gap-1 text-sm">
          <span className="text-muted">Открытая смена</span>
          <select
            className="h-11 ui-panel px-3 outline-none focus:border-brand"
            name="shift_id"
            onChange={(event) => {
              setShiftId(event.target.value);
              setRecipientId("");
            }}
            required
            value={shiftId}
          >
            {shifts.length === 0 ? <option value="">Нет открытых смен</option> : shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>{formatShiftOption(shift)}</option>
            ))}
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
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Аванс</span>
            <input
              className="h-11 ui-panel px-3 outline-none focus:border-brand"
              inputMode="decimal"
              max={MONEY_INPUT_MAX}
              min="0"
              name="advance_amount"
              onChange={(event) => setAdvanceAmount(event.target.value)}
              step="0.01"
              type="number"
              value={advanceAmount}
            />
          </label>
        </div>
        {requiresRecipient ? (
          <label className="mt-3 grid gap-1 text-sm">
            <span className="text-muted">Кому выдать аванс</span>
            <select
              className="h-11 ui-panel px-3 outline-none focus:border-brand"
              name="advance_employee_id"
              onChange={(event) => setRecipientId(event.target.value)}
              required
              value={recipientId}
            >
              <option value="">Выберите менеджера</option>
              {cityManagers.map((manager) => (
                <option key={manager.employee_id} value={manager.employee_id}>{manager.full_name}</option>
              ))}
            </select>
            {cityManagers.length === 0 ? <span className="text-xs text-danger">В этом городе нет доступных менеджеров.</span> : null}
          </label>
        ) : <input name="advance_employee_id" type="hidden" value="" />}
        <label className="mt-3 grid gap-1 text-sm">
          <span className="text-muted">Комментарий к выемке / РКО</span>
          <textarea
            className="min-h-20 ui-panel px-3 py-2 outline-none focus:border-brand"
            defaultValue={params.cash_collection_comment ?? ""}
            name="cash_collection_comment"
          />
        </label>
      </section>
    </>
  );
}
