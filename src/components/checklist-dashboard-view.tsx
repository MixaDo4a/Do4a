import Link from "next/link";

type MissingEmployee = { id: string; name: string; stores: string[] };

export function ChecklistDashboardView({ period, submittedCount, averageScore, missingEmployees }: {
  period: string;
  submittedCount: number;
  averageScore: number | null;
  missingEmployees: MissingEmployee[];
}) {
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${period}-01T00:00:00Z`));
  const nextMonth = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const lastDay = new Date(Date.parse(`${nextMonth}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  return <main className="dashboard-font min-h-screen overflow-x-hidden px-4 py-5 text-[#f7f2ea] md:px-8">
    <div className="mx-auto w-full max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="На главную" className="grid size-10 place-items-center rounded-lg border border-white/10 bg-black/50 text-white/75 hover:text-white">←</Link>
          <div><p className="text-xs text-white/45">Операционный дашборд</p><h1 className="text-xl font-semibold">Контроль чек-листов</h1></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/dashboard" method="get" className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3">
            <span className="text-xs text-white/45">Месяц</span><input aria-label="Месяц чек-листов" name="period" type="month" defaultValue={period} className="border-0 bg-transparent text-sm text-white outline-none" />
            <button type="submit" className="text-xs font-semibold text-red-300 hover:text-white">Показать</button>
          </form>
          <Link href={`/checklists?date_from=${period}-01&date_to=${lastDay}`} className="inline-flex h-10 items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-white/70 hover:text-white">Архив</Link>
          <Link href="/checklists/new" className="inline-flex h-10 items-center rounded-md bg-brand px-3 text-xs font-semibold text-white">Провести чек-лист</Link>
        </div>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label={`Итоги чек-листов за ${monthLabel}`}>
        <Metric label="Проведено проверок" value={String(submittedCount)} />
        <Metric label="Средний балл" value={averageScore === null ? "—" : new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(averageScore)} />
        <Metric label="Сотрудники без чек-листа" value={String(missingEmployees.length)} alert={missingEmployees.length > 0} />
      </section>

      <section className="mt-5 rounded-lg border border-white/10 bg-[#0c090a]/95 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Нет проверки · {monthLabel}</h2>
          <span className="text-xs text-white/45">Любое число смен · без ошибочных смен</span>
        </div>
        {missingEmployees.length ? <ul className="mt-3 divide-y divide-white/10">
          {missingEmployees.map((employee) => <li key={employee.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="font-medium">{employee.name}</span><span className="text-sm text-white/50">{employee.stores.join(", ")}</span>
          </li>)}
        </ul> : <p className="mt-3 rounded-md bg-white/[0.035] p-3 text-sm text-white/55">За этот месяц нет сотрудников с рабочими сменами без чек-листа.</p>}
      </section>
    </div>
  </main>;
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={`rounded-lg border bg-[#0c090a]/95 p-4 ${alert ? "border-red-400/30" : "border-white/10"}`}>
    <p className="text-xs text-white/50">{label}</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${alert ? "text-red-300" : "text-white"}`}>{value}</p>
  </div>;
}
