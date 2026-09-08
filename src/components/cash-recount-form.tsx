"use client";

import { useMemo, useState } from "react";

type Denomination = { id: string; value: number };

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export function CashRecountForm({
  storeId,
  shiftId,
  denominations,
  initialCounts = {},
  initialCoins = "",
}: {
  storeId: string;
  shiftId: string;
  denominations: Denomination[];
  initialCounts?: Record<string, string>;
  initialCoins?: string;
}) {
  const [counts, setCounts] = useState<Record<string, string>>(initialCounts);
  const [coins, setCoins] = useState(initialCoins);
  const total = useMemo(
    () => denominations.reduce((sum, denomination) => sum + denomination.value * Number(counts[denomination.id] || 0), 0) + Number(coins || 0),
    [coins, counts, denominations],
  );

  return (
    <form action="/shifts/recount/submit" className="mt-4 grid gap-3" method="post">
      <input name="store_id" type="hidden" value={storeId} />
      <input name="shift_id" type="hidden" value={shiftId} />
      <div className="grid gap-2">
        {denominations.map((denomination) => {
          const quantity = Number(counts[denomination.id] || 0);
          return (
            <label key={denomination.id} className="grid grid-cols-[72px_1fr_100px] items-center gap-2 text-sm">
              <span>{money(denomination.value)}</span>
              <input
                className="h-10 ui-panel px-3 outline-none focus:border-brand"
                inputMode="numeric"
                min="0"
                name={`denomination_${denomination.id}`}
                onChange={(event) => setCounts((current) => ({ ...current, [denomination.id]: event.target.value }))}
                step="1"
                type="number"
                value={counts[denomination.id] ?? ""}
              />
              <span className="text-right text-muted">{money(denomination.value * quantity)} руб.</span>
            </label>
          );
        })}
      </div>
      <label className="grid grid-cols-[1fr_100px] items-center gap-2 text-sm">
        <span>Мелочь в мешках</span>
        <input className="h-10 ui-panel px-3 outline-none focus:border-brand" inputMode="decimal" min="0" name="coins_amount" onChange={(event) => setCoins(event.target.value)} step="0.01" type="number" value={coins} />
      </label>
      <div className="flex items-center justify-between border-t border-line pt-3 font-semibold">
        <span>Итого</span>
        <span>{money(total)} руб.</span>
      </div>
      <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white" type="submit">Внести</button>
    </form>
  );
}
