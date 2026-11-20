import { Archive } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ storeId: string }>;
};

type SessionRow = {
  id: string;
  routine_kind: "morning" | "evening";
  routine_date: string;
  started_at: string;
  completed_at: string | null;
  employee_id: string;
};

type ItemRow = {
  id: string;
  session_id: string;
  template_item_id: string;
  title_snapshot: string;
  parent_title_snapshot: string | null;
  level: number;
  completed_at: string;
  day_routine_session_item_photos: Array<{
    file_id: string;
    files: { path: string; bucket: string } | null;
  }>;
};
type Relation<T> = T | T[] | null;
type PhotoArchiveRow = {
  file_id: string;
  files: Relation<{ path: string; bucket: string; mime_type: string | null }>;
  day_routine_session_items: Relation<{
    id: string;
    title_snapshot: string;
    completed_at: string;
    day_routine_sessions: Relation<SessionRow & { store_id: string }>;
  }>;
};

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function RoutineArchivePage({ params }: PageProps) {
  const { storeId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const stores = await getAccessibleStores();
  const store = stores.find((item) => item.id === storeId);
  if (!store) {
    redirect("/routine");
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("day_routine_sessions")
    .select("id, routine_kind, routine_date, started_at, completed_at, employee_id")
    .eq("store_id", storeId)
    .order("routine_date", { ascending: false })
    .limit(30)
    .returns<SessionRow[]>();

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const sessionIds = sessions.map((session) => session.id);
  const employeeIds = [...new Set(sessions.map((session) => session.employee_id))];

  const [{ data: items, error: itemsError }, { data: employees, error: employeesError }] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from("day_routine_session_items")
          .select("id, session_id, template_item_id, title_snapshot, parent_title_snapshot, level, completed_at, day_routine_session_item_photos(file_id, files(path, bucket))")
          .in("session_id", sessionIds)
          .order("completed_at", { ascending: true })
          .returns<ItemRow[]>()
      : Promise.resolve({ data: [] as ItemRow[], error: null as null }),
    employeeIds.length > 0
      ? supabase.from("employees").select("id, full_name").in("id", employeeIds).returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null as null }),
  ]);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  if (employeesError) {
    throw new Error(employeesError.message);
  }

  const { data: archivedPhotoRows, error: archivedPhotoError } = await supabase
    .from("day_routine_session_item_photos")
    .select("file_id, files!inner(path, bucket, mime_type), day_routine_session_items!inner(id, title_snapshot, completed_at, day_routine_sessions!inner(id, routine_kind, routine_date, started_at, completed_at, employee_id, store_id))")
    .eq("day_routine_session_items.day_routine_sessions.store_id", storeId)
    .limit(200)
    .returns<PhotoArchiveRow[]>();

  if (archivedPhotoError) throw new Error(archivedPhotoError.message);

  const archivedPhotos = await Promise.all((archivedPhotoRows ?? []).map(async (row) => {
    const file = one(row.files);
    const item = one(row.day_routine_session_items);
    const session = item ? one(item.day_routine_sessions) : null;
    if (!file || !item || !session || file.bucket !== "routine-photos" || !file.mime_type?.startsWith("image/")) return null;
    const { data, error } = await supabase.storage.from(file.bucket).createSignedUrl(file.path, 60 * 60);
    if (error || !data?.signedUrl) return null;
    return { ...session, itemTitle: item.title_snapshot, photoUrl: data.signedUrl };
  }));
  const photosBySession = new Map<string, NonNullable<(typeof archivedPhotos)[number]>[]>();
  for (const photo of archivedPhotos) {
    if (!photo) continue;
    const rows = photosBySession.get(photo.id) ?? [];
    rows.push(photo);
    photosBySession.set(photo.id, rows);
  }
  const archivedPhotoSessions = [...photosBySession.values()]
    .map((photos) => photos[0])
    .filter((session): session is NonNullable<typeof session> => Boolean(session))
    .sort((left, right) => right.routine_date.localeCompare(left.routine_date));
  const photoEmployeeIds = [...new Set(archivedPhotoSessions.map((session) => session.employee_id))];
  const { data: photoEmployees, error: photoEmployeesError } = photoEmployeeIds.length
    ? await supabase.from("employees").select("id, full_name").in("id", photoEmployeeIds).returns<{ id: string; full_name: string }[]>()
    : { data: [] as { id: string; full_name: string }[], error: null };
  if (photoEmployeesError) throw new Error(photoEmployeesError.message);
  const photoEmployeeNames = new Map((photoEmployees ?? []).map((employee) => [employee.id, employee.full_name]));

  const employeeById = new Map((employees ?? []).map((employee) => [employee.id, employee.full_name]));
  const itemsBySessionId = new Map<string, ItemRow[]>();
  (items ?? []).forEach((item) => {
    const next = itemsBySessionId.get(item.session_id) ?? [];
    next.push(item);
    itemsBySessionId.set(item.session_id, next);
  });

  const photoUrlsByItemId = new Map<string, string[]>();
  await Promise.all(
    (items ?? []).map(async (item) => {
      const urls = await Promise.all(
        (item.day_routine_session_item_photos ?? []).map(async (photo) => {
          if (!photo.files) return null;
          const { data } = await supabase.storage.from(photo.files.bucket).createSignedUrl(photo.files.path, 3600);
          return data?.signedUrl ?? null;
        }),
      );
      photoUrlsByItemId.set(item.id, urls.filter((url): url is string => Boolean(url)));
    }),
  );

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={Archive} title={`Архив распорядка · ${store.name}`} showBack />
        <section className="mt-4 ui-panel p-4 shadow-soft">
          <p className="text-sm text-muted">{store.city}</p>
        </section>

        <section className="mt-4 ui-panel p-4 shadow-soft">
          <h2 className="font-semibold">Фотографии утреннего и вечернего распорядка</h2>
          <p className="mt-1 text-sm text-muted">Все сохранённые фото по магазину, включая более старые записи.</p>
          {archivedPhotoSessions.length === 0 ? <p className="mt-3 text-sm text-muted">Прикреплённых фотографий пока нет.</p> : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {archivedPhotoSessions.map((session) => (
                <article key={session.id} className="rounded-xl border border-line/80 bg-[#0d090a]/92 p-3">
                  <h3 className="text-sm font-semibold">{session.routine_kind === "morning" ? "Утро" : "Вечер"} · {session.routine_date}</h3>
                  <p className="mt-1 text-xs text-muted">{photoEmployeeNames.get(session.employee_id) ?? "Сотрудник"}</p>
                  <div className="mt-2 grid gap-2">
                    {(photosBySession.get(session.id) ?? []).map((photo, index) => (
                      <a key={`${session.id}_${index}_${photo.itemTitle}`} href={photo.photoUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
                        <Image alt={`Фото пункта: ${photo.itemTitle}`} className="h-auto w-full" height={900} src={photo.photoUrl} unoptimized width={1200} />
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4">
          {sessions.length === 0 ? (
            <section className="ui-panel p-4 text-sm text-muted shadow-soft">
              По этому магазину ещё нет заполненных распорядков.
            </section>
          ) : null}

          {sessions.map((session) => {
            const sessionItems = itemsBySessionId.get(session.id) ?? [];

            return (
              <article key={session.id} className="ui-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {session.routine_kind === "morning" ? "Утро" : "Вечер"} · {session.routine_date}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{employeeById.get(session.employee_id) ?? "Сотрудник"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${session.completed_at ? "bg-brand/15 text-brand" : "bg-white/10 text-muted"}`}>
                    {session.completed_at ? "Заполнено" : "В процессе"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2">
                  {sessionItems.length === 0 ? (
                    <p className="text-sm text-muted">Пока ничего не отмечено.</p>
                  ) : (
                    sessionItems.map((item) => (
                      <div key={`${session.id}_${item.title_snapshot}_${item.completed_at}`} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-3">
                        <p className="text-sm" style={{ marginLeft: item.level * 12 }}>
                          {item.title_snapshot}
                        </p>
                        <p className="mt-1 text-[11px] text-muted">{formatDate(item.completed_at)}</p>
                        {(photoUrlsByItemId.get(item.id) ?? []).map((url, index) => (
                          <a key={`${item.id}_photo_${index}`} className="mt-2 block overflow-hidden rounded-xl" href={url} target="_blank" rel="noreferrer">
                            <Image alt={`Фото: ${item.title_snapshot}`} className="h-auto w-full" height={900} src={url} unoptimized width={1200} />
                          </a>
                        ))}
                        {item.parent_title_snapshot ? <p className="mt-1 text-[11px] text-muted">Пункт: {item.parent_title_snapshot}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
