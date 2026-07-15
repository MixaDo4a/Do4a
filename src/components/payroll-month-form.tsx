"use client";

import { Calculator } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

type PayrollMonthFormProps = {
  month: string;
  canRecalculate: boolean;
};

export function PayrollMonthForm({ month, canRecalculate }: PayrollMonthFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action="/payroll/calculate"
      className="mt-4 grid gap-3 rounded-md border border-line bg-white p-4 shadow-soft sm:grid-cols-[1fr_auto]"
      method="post"
    >
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Месяц</span>
        <input
          className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand"
          defaultValue={month}
          name="period_month"
          onChange={(event) => {
            if (canRecalculate) {
              formRef.current?.requestSubmit();
              return;
            }

            router.push(`/payroll?period=${event.currentTarget.value}`);
          }}
          type="month"
        />
      </label>
      {canRecalculate ? (
        <button className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-md bg-brand px-4 font-semibold text-white">
          <Calculator size={18} /> Пересчитать
        </button>
      ) : null}
    </form>
  );
}

