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
  searchParams: Promise<{ work?: string; correction?: string; detail?: string }>;
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
  is_erroneous: boolean;
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
  denomination_id: string;
  quantity: number;
  line_amount: number;
  cash_denominations: { id: string; value: number; kind: string } | null;
};
type CashDenomination = { id: string; value: number; kind: string; is_active: boolean };
type ClosingReportAudit = {
  id: string;
  changed_by_employee_id: string | null;
  actor_role: "store_manager" | "super_admin" | "developer";
  reason: string;
  previous_shift: Record<string, unknown>;
  next_shift: Record<string, unknown>;
  previous_report: Record<string, unknown>;
  next_report: Record<string, unknown>;
  previous_cash_counts: { denomination_id: string; value: number; kind: string; quantity: number }[];
  next_cash_counts: { denomination_id: string; value: number; kind: string; quantity: number }[];
  created_at: string;
};
type WorkTimeAudit = {
  id: string;
  participant_id: string;
  changed_by: string;
  changed_by_role: "store_manager" | "super_admin" | "developer" | null;
  previous_value: Record<string, unknown> | null;
  next_value: Record<string, unknown>;
  reason: string;
  created_at: string;
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

function formatAuditDateTime(value: string, timeZone: string | null | undefined) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
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

const correctionFieldLabels: Record<string, string> = {
  opened_at: "Время открытия",
  closed_at: "Время закрытия",
  started_at: "Начало работы",
  ended_at: "Окончание работы",
  cash_revenue: "Наличные",
  card_revenue: "Безналичные",
  cash_returns: "Возвраты наличными",
  card_returns: "Возвраты безналом",
  gross_revenue: "Выручка до возвратов",
  net_revenue: "Выручка после возвратов",
  receipt_count: "Количество чеков",
  items_sold_count: "Продано товаров",
  cash_collection_amount: "Инкассация",
  cash_collection_comment: "Комментарий к инкассации",
  check_depth: "Глубина чека",
  advance_amount: "Аванс",
  actual_cash_amount: "Наличные по Z-отчёту",
};

function auditDisplayValue(key: string, value: unknown, timeZone: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (["opened_at", "closed_at", "started_at", "ended_at"].includes(key)) return formatDateTime(String(value), timeZone);
  if (["cash_revenue", "card_revenue", "cash_returns", "card_returns", "gross_revenue", "net_revenue", "cash_collection_amount", "advance_amount", "actual_cash_amount"].includes(key)) {
    return `${formatMoney(Number(value))} руб.`;
  }
  return String(value);
}

function buildCorrectionDiff(audit: ClosingReportAudit, timeZone: string | null | undefined) {
  const changes: { key: string; label: string; before: string; after: string }[] = [];
  const compare = (key: string, previous: unknown, next: unknown) => {
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) return;
    changes.push({
      key,
      label: correctionFieldLabels[key] ?? key,
      before: auditDisplayValue(key, previous, timeZone),
      after: auditDisplayValue(key, next, timeZone),
    });
  };
  for (const key of ["opened_at", "closed_at"]) compare(key, audit.previous_shift[key], audit.next_shift[key]);
  for (const key of Object.keys(correctionFieldLabels).filter((field) => field !== "opened_at" && field !== "closed_at")) {
    compare(key, audit.previous_report[key], audit.next_report[key]);
  }

  const previousCounts = new Map(audit.previous_cash_counts.map((row) => [row.denomination_id, row]));
  const nextCounts = new Map(audit.next_cash_counts.map((row) => [row.denomination_id, row]));
  for (const id of new Set([...previousCounts.keys(), ...nextCounts.keys()])) {
    const previous = previousCounts.get(id);
    const next = nextCounts.get(id);
    if ((previous?.quantity ?? 0) === (next?.quantity ?? 0)) continue;
    const row = next ?? previous;
    const unit = row?.kind === "coin" ? "монета" : "купюра";
    changes.push({
      key: `cash_count:${id}`,
      label: `Покупюрник · ${formatMoney(row?.value)} руб. (${unit})`,
      before: `${previous?.quantity ?? 0} шт.`,
      after: `${next?.quantity ?? 0} шт.`,
    });
  }
  return changes;
}

function buildWorkTimeDiff(audit: WorkTimeAudit | undefined, timeZone: string | null | undefined) {
  if (!audit) return [];
  const fields = [
    ["started_at", "Начало работы"],
    ["ended_at", "Окончание работы"],
    ["paid_hours", "Оплачиваемые часы"],
  ] as const;
  return fields.flatMap(([key, label]) => {
    const before = audit.previous_value?.[key] ?? null;
    const after = audit.next_value[key] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    const format = (value: unknown) => key === "started_at" || key === "ended_at"
      ? auditDisplayValue(key, value, timeZone)
      : value === null || value === undefined ? "—" : `${formatMoney(Number(value))} ч.`;
    return [{ key, label, before: format(before), after: format(after) }];
  });
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-amber-500/70 bg-amber-50" : "border-line bg-surface"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}{highlight ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">Изменено</span> : null}</p>
    </div>
  );
}

export default async function ShiftDetailsPage({ params, searchParams }: ShiftDetailsPageProps) {
  const { id } = await params;
  const { work: workMessage, correction: correctionMessage, detail: workDetail } = await searchParams;
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
        is_erroneous,
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
  const managementRole = hasAnyRole(roles, ["store_manager", "super_admin", "developer"]);
  const managerOnlyRole = roles.includes("store_manager") && !hasAnyRole(roles, ["super_admin", "developer"]);
  const managerStores = roles.includes("store_manager") ? await getAccessibleStores(supabase) : [];
  const managerHasStoreAccess = managerStores.some((store) => store.id === shift.store_id);
  const canCorrectWork = managementRole && (hasAnyRole(roles, ["super_admin", "developer"]) || managerHasStoreAccess);
  const canEditClosedReport = canCorrectWork && (shift.status === "closed" || shift.status === "auto_closed");
  const canShowManagerAudit = managerOnlyRole && managerHasStoreAccess && canEditClosedReport;
  const shiftIsOpen = shift.status === "opened" || shift.status === "correction_required";

  const report = single(shift.shift_closing_reports);
  const { data: cashCounts, error: cashCountsError } = report
    ? await supabase
        .from("shift_cash_counts")
        .select("denomination_id, quantity, line_amount, cash_denominations(id, value, kind)")
        .eq("shift_closing_report_id", report.id)
        .order("line_amount", { ascending: false })
        .returns<CashCount[]>()
    : { data: [] as CashCount[], error: null };

  if (cashCountsError) {
    throw new Error(cashCountsError.message);
  }

  const [auditResult, denominationResult, workAuditResult] = await Promise.all([
    canShowManagerAudit
      ? supabase.from("shift_closing_report_audit")
          .select("id, changed_by_employee_id, actor_role, reason, previous_shift, next_shift, previous_report, next_report, previous_cash_counts, next_cash_counts, created_at")
          .eq("shift_id", shift.id).eq("actor_role", "store_manager").order("created_at", { ascending: false }).limit(25).returns<ClosingReportAudit[]>()
      : Promise.resolve({ data: [] as ClosingReportAudit[], error: null }),
    canEditClosedReport
      ? supabase.from("cash_denominations").select("id, value, kind, is_active").order("value", { ascending: false }).returns<CashDenomination[]>()
      : Promise.resolve({ data: [] as CashDenomination[], error: null }),
    canShowManagerAudit && participantIds.length
      ? supabase.from("shift_work_time_audit").select("id, participant_id, changed_by, changed_by_role, previous_value, next_value, reason, created_at")
          .eq("changed_by_role", "store_manager")
          .in("participant_id", participantIds).order("created_at", { ascending: false }).limit(100).returns<WorkTimeAudit[]>()
      : Promise.resolve({ data: [] as WorkTimeAudit[], error: null }),
  ]);
  if (auditResult.error) throw new Error(auditResult.error.message);
  if (denominationResult.error) throw new Error(denominationResult.error.message);
  if (workAuditResult.error) throw new Error(workAuditResult.error.message);
  const correctionAudit = auditResult.data ?? [];
  const workTimeAudit = workAuditResult.data ?? [];
  const profileIds = [...new Set(workTimeAudit.map((entry) => entry.changed_by))];
  const { data: actorProfiles, error: profilesError } = profileIds.length
    ? await supabase.from("profiles").select("id, employee_id").in("id", profileIds).returns<{ id: string; employee_id: string | null }[]>()
    : { data: [] as { id: string; employee_id: string | null }[], error: null };
  if (profilesError) throw new Error(profilesError.message);
  const employeeIdsForActors = [...new Set([
    ...correctionAudit.map((entry) => entry.changed_by_employee_id).filter((id): id is string => Boolean(id)),
    ...(actorProfiles ?? []).map((profile) => profile.employee_id).filter((id): id is string => Boolean(id)),
  ])];
  const { data: correctionActors, error: actorsError } = employeeIdsForActors.length
    ? await supabase.from("employees").select("id, full_name").in("id", employeeIdsForActors).returns<{ id: string; full_name: string }[]>()
    : { data: [] as { id: string; full_name: string }[], error: null };
  if (actorsError) throw new Error(actorsError.message);
  const actorNameById = new Map((correctionActors ?? []).map((actor) => [actor.id, actor.full_name]));
  const actorEmployeeByAuthId = new Map((actorProfiles ?? []).map((profile) => [profile.id, profile.employee_id]));
  const correctionDiffs = correctionAudit.map((entry) => buildCorrectionDiff(entry, shift.stores?.timezone));
  const latestChangedFields = new Set(correctionDiffs[0]?.map((change) => change.key) ?? []);
  const latestChangedDenominations = new Set(correctionDiffs[0]?.filter((change) => change.key.startsWith("cash_count:"))
    .map((change) => change.key.slice("cash_count:".length)) ?? []);

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
        {correctionMessage === "saved" ? <p role="status" className="ui-panel mt-4 p-3 text-sm">Исправления сохранены. Изменённые поля подсвечены ниже.</p> : null}
        {correctionMessage === "error" ? <p role="alert" className="ui-panel mt-4 p-3 text-sm text-red-400">Не удалось исправить смену. {workDetail}</p> : null}
        {correctionMessage === "payroll-error" ? <p role="alert" className="ui-panel mt-4 p-3 text-sm text-red-400">Отчёт сохранён, но пересчёт рассчитанной зарплаты завершился ошибкой. {workDetail}</p> : null}

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
            <Metric label="Открыта" value={formatDateTime(shift.opened_at, shift.stores?.timezone)} highlight={latestChangedFields.has("opened_at")} />
            <Metric label="Закрыта" value={formatDateTime(shift.closed_at, shift.stores?.timezone)} highlight={latestChangedFields.has("closed_at")} />
            {report ? <Metric label="Наличные по Z-отчёту" value={`${formatMoney(report.actual_cash_amount)} руб.`} highlight={latestChangedFields.has("actual_cash_amount")} /> : null}
          </div>
        </section>

        {canEditClosedReport ? (
          <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
            <h2 className="text-base font-semibold">{canShowManagerAudit ? "История изменений и корректировка" : "Корректировка закрытия"}</h2>
            {canShowManagerAudit && correctionAudit.length ? (
              <div className="mt-3 grid gap-2">
                {correctionAudit.map((entry, index) => <article key={entry.id} className={`rounded-md border p-3 ${index === 0 ? "border-amber-400/50 bg-amber-50" : "border-line bg-surface"}`}>
                  <p className="text-sm font-semibold">Изменено управляющим: {actorNameById.get(entry.changed_by_employee_id ?? "") ?? "Управляющий"}</p>
                  <p className="mt-1 text-xs text-muted">{formatAuditDateTime(entry.created_at, shift.stores?.timezone)} · Причина: {entry.reason}</p>
                  {correctionDiffs[index]?.length ? <div className="mt-3 grid gap-2">
                    {correctionDiffs[index].map((change) => <div key={change.key} className="grid gap-1 rounded border border-amber-300/50 bg-white px-2 py-1.5 text-xs sm:grid-cols-[minmax(140px,0.8fr)_1fr_1fr]">
                      <span className="font-semibold">{change.label}</span><span className="text-muted">Было: {change.before}</span><span className="font-medium text-ink">Стало: {change.after}</span>
                    </div>)}
                  </div> : <p className="mt-2 text-xs text-muted">Сохранённых отличий не найдено.</p>}
                </article>)}
              </div>
            ) : canShowManagerAudit ? <p className="mt-2 text-sm text-muted">Изменений закрытия управляющим ещё не было.</p> : null}

            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer font-semibold">Исправить данные закрытия</summary>
              <form action={`/shifts/${shift.id}/correction`} method="post" className="mt-3 grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">Время открытия
                    <input className="h-10 rounded-md border border-line bg-surface px-3" name="opened_local" type="datetime-local" required defaultValue={localInputValue(shift.opened_at, shift.stores?.timezone)} />
                  </label>
                  <label className="grid gap-1 text-sm">Время закрытия
                    <input className="h-10 rounded-md border border-line bg-surface px-3" name="closed_local" type="datetime-local" required defaultValue={localInputValue(shift.closed_at, shift.stores?.timezone)} />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-1 text-sm">Наличные, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="cash_revenue" type="number" min="0" step="0.01" required defaultValue={report?.cash_revenue ?? 0} /></label>
                  <label className="grid gap-1 text-sm">Безналичные, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="card_revenue" type="number" min="0" step="0.01" required defaultValue={report?.card_revenue ?? 0} /></label>
                  <label className="grid gap-1 text-sm">Возвраты наличными, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="cash_returns" type="number" min="0" step="0.01" required defaultValue={report?.cash_returns ?? 0} /></label>
                  <label className="grid gap-1 text-sm">Возвраты безналом, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="card_returns" type="number" min="0" step="0.01" required defaultValue={report?.card_returns ?? 0} /></label>
                  <label className="grid gap-1 text-sm">Количество чеков<input className="h-10 rounded-md border border-line bg-surface px-3" name="receipt_count" type="number" min="0" step="1" required defaultValue={report?.receipt_count ?? 0} /></label>
                  <label className="grid gap-1 text-sm">Продано товаров<input className="h-10 rounded-md border border-line bg-surface px-3" name="items_sold_count" type="number" min="0" step="1" defaultValue={report?.items_sold_count ?? ""} /></label>
                  <label className="grid gap-1 text-sm">Глубина чека<input className="h-10 rounded-md border border-line bg-surface px-3" name="check_depth" type="number" min="0" step="0.01" defaultValue={report?.check_depth ?? ""} /></label>
                  <label className="grid gap-1 text-sm">Инкассация, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="cash_collection_amount" type="number" min="0" step="0.01" defaultValue={report?.cash_collection_amount ?? ""} /></label>
                  <label className="grid gap-1 text-sm">Аванс, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="advance_amount" type="number" min="0" step="0.01" defaultValue={report?.advance_amount ?? ""} /></label>
                  <label className="grid gap-1 text-sm">Наличные по Z-отчёту, руб.<input className="h-10 rounded-md border border-line bg-surface px-3" name="actual_cash_amount" type="number" min="0" step="0.01" defaultValue={report?.actual_cash_amount ?? ""} /></label>
                  <label className="grid gap-1 text-sm sm:col-span-2 lg:col-span-3">Комментарий к инкассации
                    <textarea className="min-h-20 rounded-md border border-line bg-surface px-3 py-2" name="cash_collection_comment" defaultValue={report?.cash_collection_comment ?? ""} />
                  </label>
                </div>
                <fieldset className="rounded-md border border-line p-3">
                  <legend className="px-1 text-sm font-semibold">Покупюрник</legend>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(denominationResult.data ?? []).map((denomination) => {
                      const existing = (cashCounts ?? []).find((row) => row.denomination_id === denomination.id)?.quantity ?? 0;
                      return <label key={denomination.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>{formatMoney(denomination.value)} руб. · {denomination.kind === "coin" ? "монеты" : "купюры"}{!denomination.is_active ? " · архивная" : ""}</span>
                        <input className="h-9 w-24 rounded-md border border-line bg-surface px-2 text-right" name={`cash_count_${denomination.id}`} type="number" min="0" step="1" defaultValue={existing} />
                      </label>;
                    })}
                  </div>
                </fieldset>
                <label className="grid gap-1 text-sm">Причина исправления
                  <textarea className="min-h-20 rounded-md border border-line bg-surface px-3 py-2" name="reason" minLength={3} maxLength={500} required />
                </label>
                <button type="submit" className="h-10 justify-self-start rounded-md bg-brand px-4 text-sm font-semibold text-white">Сохранить исправления</button>
              </form>
            </details>
          </section>
        ) : null}

        {shift.is_erroneous ? <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">Ошибочная смена. Она сохранена в архиве, но исключена из зарплаты, выручки и показателей.</p> : null}

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <UserRound size={18} /> Продавцы
          </h2>
          <div className="mt-3 grid gap-2">
            {shift.shift_participants.map((participant) => {
              const work = workByParticipant.get(participant.id);
              const participantAudits = workTimeAudit.filter((entry) => entry.participant_id === participant.id);
              const workFieldsChanged = new Set(buildWorkTimeDiff(participantAudits[0], shift.stores?.timezone).map((change) => change.key));
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
                    <p className={workFieldsChanged.has("started_at") ? "rounded bg-amber-100 px-1 text-amber-950" : ""}>Начало: {formatDateTime(work?.started_at ?? null, shift.stores?.timezone)}{workFieldsChanged.has("started_at") ? " · изменено" : ""}</p>
                    <p className={workFieldsChanged.has("ended_at") ? "rounded bg-amber-100 px-1 text-amber-950" : ""}>Окончание: {formatDateTime(work?.ended_at ?? null, shift.stores?.timezone)}{workFieldsChanged.has("ended_at") ? " · изменено" : ""}</p>
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
                {canCorrectWork && participantAudits.length ? <details className="mt-3 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm font-medium">История изменений времени ({participantAudits.length})</summary>
                  <div className="mt-2 grid gap-2">
                    {participantAudits.map((entry) => {
                      const changes = buildWorkTimeDiff(entry, shift.stores?.timezone);
                      const actorEmployeeId = actorEmployeeByAuthId.get(entry.changed_by);
                      return <article key={entry.id} className="rounded border border-amber-300/50 bg-amber-50 p-2 text-xs">
                        <p className="font-semibold">Изменено управляющим: {actorNameById.get(actorEmployeeId ?? "") ?? "Управляющий"}</p>
                        <p className="mt-0.5 text-muted">{formatAuditDateTime(entry.created_at, shift.stores?.timezone)} · Причина: {entry.reason}</p>
                        {changes.map((change) => <p key={change.key} className="mt-1">{change.label}: <span className="text-muted">{change.before}</span> → <span className="font-semibold">{change.after}</span></p>)}
                      </article>;
                    })}
                  </div>
                </details> : null}
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
                <Metric label="Выручка наличными" value={`${formatMoney(report.cash_revenue)} ?`} highlight={latestChangedFields.has("cash_revenue")} />
                <Metric label="Выручка безналом" value={`${formatMoney(report.card_revenue)} ?`} highlight={latestChangedFields.has("card_revenue")} />
                <Metric label="Возвраты наличными" value={`${formatMoney(report.cash_returns)} ?`} highlight={latestChangedFields.has("cash_returns")} />
                <Metric label="Возвраты безналом" value={`${formatMoney(report.card_returns)} ?`} highlight={latestChangedFields.has("card_returns")} />
                <Metric label="Выручка итого" value={`${formatMoney(report.gross_revenue)} ?`} highlight={latestChangedFields.has("gross_revenue")} />
                <Metric label="Выручка после возвратов" value={`${formatMoney(report.net_revenue)} ?`} highlight={latestChangedFields.has("net_revenue")} />
                <Metric label="Количество чеков" value={String(report.receipt_count)} highlight={latestChangedFields.has("receipt_count")} />
                <Metric label="Глубина чека" value={report.check_depth ? String(report.check_depth) : "Не указано"} highlight={latestChangedFields.has("check_depth")} />
                <Metric label="Количество товаров" value={report.items_sold_count ? String(report.items_sold_count) : "Не указано"} highlight={latestChangedFields.has("items_sold_count")} />
                <Metric label="Инкассация" value={`${formatMoney(report.cash_collection_amount)} ?`} highlight={latestChangedFields.has("cash_collection_amount")} />
                <Metric label="Аванс" value={`${formatMoney(report.advance_amount)} ?`} highlight={latestChangedFields.has("advance_amount")} />
                <Metric label="Отчет заполнен" value={formatDateTime(report.created_at, shift.stores?.timezone)} />
              </div>
              {report.cash_collection_comment ? (
                <div className={`mt-3 rounded-md p-3 text-sm ${latestChangedFields.has("cash_collection_comment") ? "border border-amber-400/60 bg-amber-50" : "bg-surface"}`}>
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
                    className={`grid grid-cols-[1fr_80px_120px] gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0 ${latestChangedDenominations.has(row.denomination_id) ? "bg-amber-50" : ""}`}
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


