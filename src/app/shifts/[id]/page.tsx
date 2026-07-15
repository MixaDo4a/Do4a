import { Banknote, Camera, CalendarDays, ReceiptText, Store, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ShiftDetailsPageProps = {
  params: Promise<{ id: string }>;
};

type Participant = {
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
  shift_date: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  stores: { name: string } | null;
  shift_participants: Participant[];
  shift_closing_reports: ClosingReport | ClosingReport[] | null;
  cash_report_files: CashReportFile[];
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "Не указано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

export default async function ShiftDetailsPage({ params }: ShiftDetailsPageProps) {
  const { id } = await params;
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
        shift_date,
        status,
        opened_at,
        closed_at,
        stores(name),
        shift_participants(participant_role, sales_percent, employees(full_name)),
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
            <Metric label="Открыта" value={formatDateTime(shift.opened_at)} />
            <Metric label="Закрыта" value={formatDateTime(shift.closed_at)} />
          </div>
        </section>

        <section className="mt-4 rounded-md border border-line bg-white p-4 shadow-soft">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <UserRound size={18} /> Продавцы
          </h2>
          <div className="mt-3 grid gap-2">
            {shift.shift_participants.map((participant) => (
              <div
                key={participant.participant_role}
                className="flex items-center justify-between gap-3 rounded-md bg-surface p-3 text-sm"
              >
                <div>
                  <p className="font-semibold">{participant.employees?.full_name ?? "Сотрудник не указан"}</p>
                  <p className="text-muted">{participantLabels[participant.participant_role]}</p>
                </div>
                <span className="font-semibold">{Number(participant.sales_percent) * 100}%</span>
              </div>
            ))}
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
                <Metric label="Отчет заполнен" value={formatDateTime(report.created_at)} />
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
                    <img alt="Фото отчета ККМ" className="h-auto w-full" src={photo.signedUrl} />
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


