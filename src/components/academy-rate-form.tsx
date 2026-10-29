"use client";

import { useState } from "react";

export type AcademyRateInput = {
  level: number;
  effective_from: string;
  hourly_rate: number;
  base_commission_percent: number;
  plan_commission_percent: number;
};

export function AcademyRateForm({ rates }: { rates: AcademyRateInput[] }) {
  const [level, setLevel] = useState(1);
  const [hourlyRate, setHourlyRate] = useState(String(rates.find((rate) => rate.level === 1)?.hourly_rate ?? ""));
  const [basePercent, setBasePercent] = useState(String(rates.find((rate) => rate.level === 1)?.base_commission_percent ?? ""));
  const [planPercent, setPlanPercent] = useState(String(rates.find((rate) => rate.level === 1)?.plan_commission_percent ?? ""));

  function selectLevel(nextLevel: number) {
    const rate = rates.find((item) => item.level === nextLevel);
    setLevel(nextLevel);
    setHourlyRate(String(rate?.hourly_rate ?? ""));
    setBasePercent(String(rate?.base_commission_percent ?? ""));
    setPlanPercent(String(rate?.plan_commission_percent ?? ""));
  }

  return (
    <form action="/finances/rates/save" className="mt-4 grid gap-3" method="post">
      <label className="grid gap-1 text-sm">
        <span>Уровень</span>
        <select className="h-11 rounded-md border border-line px-3" name="level" onChange={(event) => selectLevel(Number(event.target.value))} value={level}>
          {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>LVL{index + 1}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Действует с месяца</span>
        <input className="h-11 rounded-md border border-line px-3" min="2026-11" name="month" required type="month" />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Ставка за час, руб.</span>
        <input className="h-11 rounded-md border border-line px-3" min="0.01" name="hourly_rate" onChange={(event) => setHourlyRate(event.target.value)} required step="0.01" type="number" value={hourlyRate} />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Базовая комиссия, %</span>
        <input className="h-11 rounded-md border border-line px-3" max="100" min="0" name="base_commission_percent" onChange={(event) => {
          setBasePercent(event.target.value);
          if (level < 5) setPlanPercent(event.target.value);
        }} required step="0.01" type="number" value={basePercent} />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Комиссия при выполнении плана, %</span>
        <input className="h-11 rounded-md border border-line px-3" disabled={level < 5} max="100" min="0" name="plan_commission_percent" onChange={(event) => setPlanPercent(event.target.value)} required={level >= 5} step="0.01" type="number" value={planPercent} />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Причина изменения</span>
        <textarea className="min-h-20 rounded-md border border-line px-3 py-2" minLength={4} name="reason" required />
      </label>
      <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white" type="submit">Сохранить ставку</button>
    </form>
  );
}
