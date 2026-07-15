import { ClipboardCheck, Search } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { CHECKLIST_ROLES, getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{
    store_id?: string;
    employee_id?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

type StoreRow = { id: string; name: string; city: string };
type EmployeeRow = { id: string; full_name: string };

type ChecklistRow = {
  id: string;
  submitted_at: string;
  average_score: number | string;
  salary_per_shift_amount: number | string;
  comment: string | null;
  stores: { id: string; name: string; city: string } | null;
  employees: { id: string; full_name: string } | null;
  auditor: { full_name: string } | null;
  checklist_submission_items: {
    id: string;
    item_id: string;
    score: number;
    comment: string | null;
    checklist_submission_item_files: {
      file_id: string;
      files: { id: string; path: string; bucket: string } | null;
    }[];
  }[];
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

export default async function ChecklistsArchivePage({ searchParams }: PageProps) {
  const params = await searchParams;
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

  const { employeeId } = await getCurrentEmployeeId();
  const canSeeAll = hasAnyRole(roles, ["super_admin", "developer"]);
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  let query = supabase
    .from("checklist_submissions")
    .select(
      "id, submitted_at, average_score, salary_per_shift_amount, comment, stores(id, name, city), employees!checklist_submissions_employee_id_fkey(id, full_name), auditor:employees!checklist_submissions_auditor_employee_id_fkey(full_name), checklist_submission_items(id, item_id, score, comment, checklist_submission_item_files(file_id, files(id, path, bucket)))",
    )
    .order("submitted_at", { ascending: false })
    .limit(100);

  if (!canSeeAll && employeeId) {
    query = query.eq("auditor_employee_id", employeeId);
  }
  if (params.store_id) {
    query = query.eq("store_id", params.store_id);
  }
  if (params.employee_id) {
    query = query.eq("employee_id", params.employee_id);
  }
  if (params.date_from) {
    query = query.gte("submitted_at", `${params.date_from}T00:00:00`);
  }
  if (params.date_to) {
    query = query.lte("submitted_at", `${params.date_to}T23:59:59`);
  }
  if (!canSeeAll && accessibleStoreIds.length > 0) {
    query = query.in("store_id", accessibleStoreIds);
  }

  const [employeesResult, checklistsResult] = await Promise.all([
    supabase.from("employees").select("id, full_name").eq("is_active", true).order("full_name").returns<EmployeeRow[]>(),
    query.returns<ChecklistRow[]>(),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (checklistsResult.error) throw new Error(checklistsResult.error.message);

  const stores = accessibleStores;

  const checklistRows = await Promise.all(
    checklistsResult.data.map(async (item) => {
      const photos: { item_id: string; urls: string[] }[] = [];
      for (const submissionItem of item.checklist_submission_items) {
        const urls: string[] = [];
        for (const fileRow of submissionItem.checklist_submission_item_files) {
          if (!fileRow.files) continue;
          const { data } = await supabase.storage.from(fileRow.files.bucket).createSignedUrl(fileRow.files.path, 3600);
          if (data?.signedUrl) {
            urls.push(data.signedUrl);
          }
        }
        photos.push({ item_id: submissionItem.item_id, urls });
      }
      return { ...item, photos };
    }),
  );

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={ClipboardCheck} title="Архив чек-листов" action="Новый чек" href="/checklists/new" showBack />

        <section className="mt-4 ui-panel p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Магазин</span>
              <select className="h-11 ui-panel px-3" name="store_id" defaultValue={params.store_id ?? ""}>
                <option value="">Все магазины</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}, {store.city}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-muted">Менеджер</span>
              <select className="h-11 ui-panel px-3" name="employee_id" defaultValue={params.employee_id ?? ""}>
                <option value="">Все менеджеры</option>
                {employeesResult.data.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-muted">С даты</span>
              <input className="h-11 ui-panel px-3" defaultValue={params.date_from ?? ""} name="date_from" type="date" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-muted">По дату</span>
              <input className="h-11 ui-panel px-3" defaultValue={params.date_to ?? ""} name="date_to" type="date" />
            </label>

            <button className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-md bg-brand px-4 font-semibold text-white">
              <Search size={17} /> Найти
            </button>
          </form>
        </section>

        <section className="mt-4 grid gap-3">
          {checklistRows.length === 0 ? (
            <article className="ui-panel p-4 text-sm text-muted shadow-soft">Проверок по выбранным фильтрам нет.</article>
          ) : null}

          {checklistRows.map((item) => (
            <article key={item.id} className="ui-panel p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{formatDate(item.submitted_at)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {item.stores?.name ?? "Магазин"} · {employeeName(item.employees)}
                  </p>
                  <p className="mt-1 text-sm text-muted">Проверяющий: {item.auditor?.full_name ?? "Не указан"}</p>
                  {item.comment ? <p className="mt-2 text-sm">{item.comment}</p> : null}
                </div>
                <div className="grid gap-1 text-sm sm:text-right">
                  <span className="font-semibold">Средний балл: {Number(item.average_score).toFixed(2)}</span>
                  <span className="text-muted">Оклад за смену: {money(item.salary_per_shift_amount)}</span>
                </div>
              </div>
              <div className="mt-3">
                <a className="inline-flex h-9 items-center justify-center ui-panel px-3 text-sm font-semibold" href={`/checklists/${item.id}`}>
                  Открыть
                </a>
              </div>
            </article>
          ))}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}



