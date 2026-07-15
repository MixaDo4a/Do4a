import { ClipboardCheck, Store, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { CHECKLIST_ROLES, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { cleanText, employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

type ChecklistItemRow = {
  id: string;
  score: number;
  comment: string | null;
  checklist_items: { id: string; title: string; sort_order: number } | null;
  checklist_submission_item_files: { file_id: string; files: { id: string; path: string; bucket: string } | null }[];
};

type ChecklistRow = {
  id: string;
  store_id: string;
  submitted_at: string;
  average_score: number | string;
  salary_per_shift_amount: number | string;
  comment: string | null;
  stores: { name: string; city: string } | null;
  employees: { id: string; full_name: string } | null;
  auditor: { full_name: string } | null;
  checklist_submission_items: ChecklistItemRow[];
};

type StoreChecklistSettingRow = {
  item_id: string;
  custom_title: string | null;
};

function money(value: number | string | null | undefined) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value ?? 0))} руб.`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ChecklistViewPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CHECKLIST_ROLES)) {
    redirect("/");
  }

  const { data, error } = await supabase
    .from("checklist_submissions")
    .select(
      "id, store_id, submitted_at, average_score, salary_per_shift_amount, comment, stores(name, city), employees!checklist_submissions_employee_id_fkey(id, full_name), auditor:employees!checklist_submissions_auditor_employee_id_fkey(full_name), checklist_submission_items(id, score, comment, checklist_items(id, title, sort_order), checklist_submission_item_files(file_id, files(id, path, bucket)))",
    )
    .eq("id", id)
    .single<ChecklistRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const { data: settingsData, error: settingsError } = await supabase
    .from("store_checklist_item_settings")
    .select("item_id, custom_title")
    .eq("store_id", data.store_id)
    .returns<StoreChecklistSettingRow[]>();

  if (settingsError) {
    throw new Error(settingsError.message);
  }

  const titleByItemId = new Map((settingsData ?? []).map((row) => [row.item_id, row.custom_title ?? ""]));

  const items = [...data.checklist_submission_items].sort(
    (left, right) => (left.checklist_items?.sort_order ?? 0) - (right.checklist_items?.sort_order ?? 0),
  );

  const signedPhotos = new Map<string, string[]>();
  for (const item of items) {
    const urls: string[] = [];
    for (const fileRow of item.checklist_submission_item_files) {
      if (!fileRow.files) {
        continue;
      }
      const { data: signed } = await supabase.storage.from(fileRow.files.bucket).createSignedUrl(fileRow.files.path, 3600);
      if (signed?.signedUrl) {
        urls.push(signed.signedUrl);
      }
    }
    signedPhotos.set(item.id, urls);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={ClipboardCheck} title="Проведённый чек-лист" showBack />

        <section className="mt-4 ui-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{formatDate(data.submitted_at)}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <Store size={16} /> {data.stores?.name ?? "Магазин"}, {data.stores?.city ?? ""}
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <UserRound size={16} /> {employeeName(data.employees)} · Проверяющий: {data.auditor?.full_name ?? "Не указан"}
              </p>
            </div>
            <div className="grid gap-1 text-right text-sm">
              <span className="font-semibold">Средний балл: {Number(data.average_score).toFixed(2)}</span>
              <span className="text-muted">Оклад за смену: {money(data.salary_per_shift_amount)}</span>
            </div>
          </div>
          {data.comment ? <p className="mt-3 rounded-md bg-surface p-3 text-sm">{data.comment}</p> : null}
        </section>

        <section className="mt-4 grid gap-3">
          {items.map((item) => {
            const urls = signedPhotos.get(item.id) ?? [];

            return (
              <article key={item.id} className="ui-panel p-4">
                <p className="font-semibold">
                  {cleanText(titleByItemId.get(item.checklist_items?.id ?? "") || item.checklist_items?.title, "Пункт чек-листа")}
                </p>
                <p className="mt-1 text-sm text-muted">Оценка: {item.score}/10</p>
                {item.comment ? <p className="mt-3 rounded-md bg-surface p-3 text-sm">{item.comment}</p> : null}
                {urls.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {urls.map((url) => (
                      <a key={url} className="block overflow-hidden rounded-md border border-line bg-surface" href={url} target="_blank" rel="noreferrer">
                        <img alt="Фото чек-листа" className="h-auto w-full" src={url} />
                      </a>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}



