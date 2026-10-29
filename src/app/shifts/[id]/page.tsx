import { Banknote, Camera, CalendarDays, Clock3, ReceiptText, Store, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { storeTimeZone } from "@/lib/timezone";

type ShiftDetailsPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ work?: string; detail?: string }>;
};

type Participant = {
  id: string;
  employee_id: string;
  participant_role: "primary_seller" | "secondary_seller";
  sales_percent: number;
  employees: { full_name: string } | null;
};

type ClosingReport = {
  id: string;
  cash_revenue: number;
  card_revenue: number;
  cash_returns: number;
  card_returns: number;
  receipt_count: number;
  items_sold_count: number | null;
  gross_revenue: number;
  net_revenue: number;
  cash_collection_amount: number | null;
  cash_collection_comment: string | null;
  check_depth: number | null;
  advance_amount: number | null;
  actual_cash_amount: number | null;
  created_at: string;
};

type FileRow = {
  id: string;
  bucket: string;
  path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type CashReportFile = {
  id: string;
  files: FileRow | FileRow[] | null;
};

type ShiftDetails = {
  id: string;
  store_id: string;
  shift_date: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  stores: { name: string; timezone: string | null } | null;
  shift_participants: Participant[];
  shift_closing_reports: ClosingReport | ClosingReport[] | null;
  cash_report_files: CashReportFile[];
};

type ShiftWorkTime = {
  participant_id: string;
  started_at: string | null;
  ended_at: string | null;
  confirmed_at: string | null;
  paid_hours: number | string | null;
};

type CashCount = {
  quantity: number;
  line_amount: number;
  cash_denominations: { value: number; kind: string } | null;
};

type ReportPhoto = FileRow & {
  signedUrl: string | null;
};

const statusLabels: Record<string, string> = {
  planned: "Запланирована",
  opened: "Открыта",
  closed: "Закрыта",
  auto_closed: "Автозакрыта",
  cancelled: "Отменена",
  correction_required: "Нужна проверка",
};

const participantLabels: Record<string, string> = {
  primary_seller: "Основной продавец",
  secondary_seller: "Второй продавец",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null, timeZone: string | null | undefined) {
  if (!value) {
    return "Не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: storeTimeZone(timeZone),
  }).format(new Date(value));
}

function localInputValue(value: string | null, timeZone: string | null | undefined) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: storeTimeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value ?? 0);
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

export default async function ShiftDetailsPage({ params, searchParams }: ShiftDetailsPageProps) {
  const { id } = await params;
  const { work: workMessage, detail: workDetail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: shift, error } = await supabase
    .from("shifts")
    .select(
      `
        id,
        store_id,
        shift_date,
        status,
        opened_at,
        closed_at,
        stores(name, timezone),
        shift_participants(id, employee_id, participant_role, sales_percent, employees(full_name)),
        shift_closing_reports(
          id,
          cash_revenue,
          card_revenue,
          cash_returns,
          card_returns,
          receipt_count,
          items_sold_count,
          gross_revenue,
          net_revenue,
          cash_collection_amount,
          cash_collection_comment,
          check_depth,
          advance_amount,
          actual_cash_amount,
          created_at
        ),
        cash_report_files(id, files(id, bucket, path, mime_type, size_bytes, created_at))
      `,
    )
    .eq("id", id)
    .single<ShiftDetails>();

  if (error) {
    throw new Error(error.message);
  }

  if (!shift) {
    notFound();
  }

  const participantIds = shift.shift_participants.map((participant) => participant.id);
  const { data: workTimes, error: workTimesError } = participantIds.length
    ? await supabase.from("shift_work_times")
        .select("participant_id, started_at, ended_at, confirmed_at, paid_hours")
        .in("participant_id", participantIds)
        .returns<ShiftWorkTime[]>()
    : { data: [] as ShiftWorkTime[], error: null };
  if (workTimesError) throw new Error(workTimesError.message);
  const workByParticipant = new Map((workTimes ?? []).map((work) => [work.participant_id, work]));
  const [{ employeeId }, { roles }] = await Promise.all([
    getCurrentEmployeeId(supabase, user),
    getCurrentRoleCodes(supabase, user),
  ]);
  const managerRole = hasAnyRole(roles, ["store_manager", "super_admin", "developer"]);
  const canCorrectWork = managerRole && (
    hasAnyRole(roles, ["super_admin", "developer"])
    || (await getAccessibleStores(supabase)).some((store) => store.id === shift.store_id)
  );
  const shiftIsOpen = shift.status === "opened" || shift.status === "correction_required";

  const report = single(shift.shift_closing_reports);
  const { data: cashCounts, error: cashCountsError } = report
    ? await supabase
        .from("shift_cash_counts")
        .select("quantity, line_amount, cash_denominations(value, kind)")
        .eq("shift_closing_report_id", report.id)
        .order("line_amount", { ascending: false })
        .returns<CashCount[]>()
    : { data: [] as CashCount[], error: null };

  if (cashCountsError) {
    throw new Error(cashCountsError.message);
  }

  const reportFiles = shift.cash_report_files
    .map((row) => single(row.files))
    .filter((file): file is FileRow => Boolean(file));

  const photos: ReportPhoto[] = await Promise.all(
    reportFiles.map(async (file) => {
      const { data, error: signedUrlError } = await supabase.storage
        .from(file.bucket)
        .createSignedUrl(file.path, 60 * 60);

      return {
        ...file,
        signedUrl: signedUrlError ? null : data.signedUrl,
      };
    }),
  );

  const cashCountTotal = (cashCounts ?? []).reduce((sum, row) => sum + Number(row.line_amount ?? 0), 0);

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={ReceiptText} title="Отчет смены" showBack />

        {workMessage === "saved" ? <p className="ui-panel mt-4 p-3 text-sm">Время работы сохранено.</p> : null}
        {workMessage === "error" ? <p className="ui-panel mt-4 p-3 text-sm text-red-400">Не удалось сохранить время работы. {workDetail}</p> : null}

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{formatDate(shift.shift_date)}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <Store size={16} /> {shift.stores?.name ?? "Магазин не указан"}
              </p>
            </div>
            <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">
              {statusLabels[shift.status] ?? shift.status}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Открыта" value={formatDateTime(shift.opened_at, shift.stores?.timezone)} />
            <Metric label="Закрыта" value={formatDateTime(shift.closed_at, shift.stores?.timezone)} />
            {report ? <Metric label="Наличные по Z-отчёту" value={`${formatMoney(report.actual_cash_amount)} руб.`} /> : null}
          </div>
        </section>

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <UserRound size={18} /> Продавцы
          </h2>
          <div className="mt-3 grid gap-2">
            {shift.shift_participants.map((participant) => {
              const work = workByParticipant.get(participant.id);
              const isOwnWork = participant.employee_id === employeeId;
              const canMarkWork = isOwnWork && shiftIsOpen;
              return (
              <div
                key={participant.id}
                className="rounded-md bg-surface p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{participant.employees?.full_name ?? "Сотрудник не указан"}</p>
                    <p className="text-muted">{participantLabels[participant.participant_role]}</p>
                  </div>
                  <span className="font-semibold">{Number(participant.sales_percent) * 100}%</span>
                </div>
                {isOwnWork || canCorrectWork ? (
                  <div className="mt-3 grid gap-1 text-muted">
                    <p>Начало: {formatDateTime(work?.started_at ?? null, shift.stores?.timezone)}</p>
                    <p>Окончание: {formatDateTime(work?.ended_at ?? null, shift.stores?.timezone)}</p>
                    <p className="font-medium text-ink">
                      {work?.confirmed_at
                        ? `Подтверждено: ${Number(work.paid_hours ?? 0).toLocaleString("ru-RU")} ч.`
                        : work?.ended_at ? "Ожидает проверки управляющим" : "Часы не подтверждены"}
                    </p>
                  </div>
                ) : null}
                {canMarkWork && !work?.ended_at ? (
                  <form action={`/shifts/${shift.id}/work`} method="post" className="mt-3">
                    <input type="hidden" name="action" value={work?.started_at ? "end" : "start"} />
                    <button type="submit" className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 font-semibold">
                      <Clock3 size={16} /> {work?.started_at ? "Закончить работу" : "Начать работу"}
                    </button>
                  </form>
                ) : null}
                {canCorrectWork ? (
                  <details className="mt-3 border-t border-line pt-3">
                    <summary className="cursor-pointer font-medium">Исправить отметки</summary>
                    <form action={`/shifts/${shift.id}/work`} method="post" className="mt-3 grid gap-3">
                      <input type="hidden" name="action" value="correct" />
                      <input type="hidden" name="participant_id" value={participant.id} />
                      <label className="grid gap-1">Начало работы
                        <input className="h-11 rounded-md border border-line bg-surface px-3 outline-none focus:border-brand" type="datetime-local" name="started_local" required
                          defaultValue={localInputValue(work?.started_at ?? (participant.participant_role === "primary_seller" ? shift.opened_at : null), shift.stores?.timezone)} />
                      </label>
                      <label className="grid gap-1">Окончание работы
                        <input className="h-11 rounded-md border border-line bg-surface px-3 outline-none focus:border-brand" type="datetime-local" name="ended_local" required
                          defaultValue={localInputValue(work?.ended_at ?? shift.closed_at, shift.stores?.timezone)} />
                      </label>
                      <label className="grid gap-1">Причина исправления
                        <input className="h-11 rounded-md border border-line bg-surface px-3 outline-none focus:border-brand" type="text" name="reason" minLength={3} required />
                      </label>
                      <button type="submit" className="rounded-md border border-line px-3 py-2 font-semibold">Сохранить время</button>
                    </form>
                  </details>
                ) : null}
              </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Banknote size={18} /> Касса
          </h2>
          {report ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Выручка наличными" value={`${formatMoney(report.cash_revenue)} ?`} />
                <Metric label="Выручка безналом" value={`${formatMoney(report.card_revenue)} ?`} />
                <Metric label="Возвраты наличными" value={`${formatMoney(report.cash_returns)} ?`} />
                <Metric label="Возвраты безналом" value={`${formatMoney(report.card_returns)} ?`} />
                <Metric label="Выручка итого" value={`${formatMoney(report.gross_revenue)} ?`} />
                <Metric label="Выручка после возвратов" value={`${formatMoney(report.net_revenue)} ?`} />
                <Metric label="Количество чеков" value={String(report.receipt_count)} />
                <Metric label="Глубина чека" value={report.check_depth ? String(report.check_depth) : "Не указано"} />
                <Metric label="Количество товаров" value={report.items_sold_count ? String(report.items_sold_count) : "Не указано"} />
                <Metric label="Инкассация" value={`${formatMoney(report.cash_collection_amount)} ?`} />
                <Metric label="Аванс" value={`${formatMoney(report.advance_amount)} ?`} />
                <Metric label="Отчет заполнен" value={formatDateTime(report.created_at, shift.stores?.timezone)} />
              </div>
              {report.cash_collection_comment ? (
                <div className="mt-3 rounded-md bg-surface p-3 text-sm">
                  <p className="text-xs text-muted">Комментарий к выемке / РКО</p>
                  <p className="mt-1">{report.cash_collection_comment}</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">По этой смене отчет кассы еще не заполнен.</p>
          )}
        </section>

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CalendarDays size={18} /> Покупюрник
          </h2>
          {(cashCounts ?? []).length > 0 ? (
            <>
              <div className="mt-3 overflow-hidden rounded-md border border-line">
                {(cashCounts ?? []).map((row) => (
                  <div
                    key={`${row.cash_denominations?.value}-${row.cash_denominations?.kind}`}
                    className="grid grid-cols-[1fr_80px_120px] gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0"
                  >
                    <span>{formatMoney(row.cash_denominations?.value)} ?</span>
                    <span className="text-right">{row.quantity} шт.</span>
                    <span className="text-right font-semibold">{formatMoney(row.line_amount)} ?</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-right text-sm font-semibold">Итого в покупюрнике: {formatMoney(cashCountTotal)} ?</p>
            </>
          ) : (
            <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">Покупюрник по этой смене не заполнен.</p>
          )}
        </section>

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Camera size={18} /> Фото отчета ККМ
          </h2>
          {photos.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {photos.map((photo) => (
                <a
                  key={photo.id}
                  className="block overflow-hidden rounded-md border border-line bg-surface"
                  href={photo.signedUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {photo.signedUrl ? (
                    <Image alt="Фото отчета ККМ" className="h-auto w-full" height={900} src={photo.signedUrl} unoptimized width={1200} />
                  ) : (
                    <span className="block p-4 text-sm text-muted">Не удалось открыть фото.</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">Фото отчета ККМ к этой смене не прикреплено.</p>
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}


