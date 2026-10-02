import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { TaskQualityScore } from "@/components/task-quality-score";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTaskQualityPeriod, summarizeTaskQuality, type PersonalTaskDeadline } from "@/lib/task-quality";
import { getCurrentRoleCodes } from "@/lib/auth/roles";

type ProfileRow = {
  employee_id: string | null;
  full_name: string;
  email: string | null;
  employees: { employee_status: "padawan" | "experienced" } | null;
};

type PageProps = {
  searchParams: Promise<{ message?: string }>;
};

const messages: Record<string, string> = {
  "password-changed": "Пароль успешно изменён.",
  "password-error": "Не удалось изменить пароль. Проверьте текущий пароль и требования к новому.",
  "password-mismatch": "Новые пароли не совпадают.",
  "password-length": "Новый пароль должен содержать от 8 до 128 символов.",
};

const roleLabels: Record<string, string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  buyer: "Закупщик",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-администратор",
  developer: "Разработчик",
};

export default async function ProfilePage({ searchParams }: PageProps) {
  const { message } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile, error }, roleState] = await Promise.all([
    supabase
      .from("profiles")
      .select("employee_id, full_name, email, employees(employee_status)")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    getCurrentRoleCodes(supabase, user),
  ]);
  if (error) throw new Error(error.message);

  const isManager = roleState.allRoles.includes("manager");
  let quality = null;
  if (isManager && profile?.employee_id) {
    const { start, end } = getTaskQualityPeriod();
    const { data, error: tasksError } = await supabase
      .from("tasks")
      .select("due_at, completed_at, status")
      .eq("assignee_employee_id", profile.employee_id)
      .gte("due_at", start)
      .lte("due_at", end)
      .neq("status", "cancelled")
      .returns<PersonalTaskDeadline[]>();
    if (tasksError) throw new Error(tasksError.message);
    quality = summarizeTaskQuality(data ?? []);
  }

  const statusLabel = profile?.employees?.employee_status === "experienced"
    ? "Бывалый"
    : profile?.employees?.employee_status === "padawan"
      ? "Падаван"
      : "Не указан";

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={UserRound} title="Профиль" showBack />
        {message && messages[message] ? <p className="mt-4 ui-panel p-3 text-sm text-muted">{messages[message]}</p> : null}

        <section className="mt-4 ui-panel p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-surface">
              <UserRound className="text-brand" size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{profile?.full_name ?? user.email ?? "Сотрудник"}</h2>
              <p className="truncate text-sm text-muted">{profile?.email ?? user.email}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-surface p-3">
              <p className="text-sm text-muted">Статус</p>
              <p className="mt-1 inline-flex items-center gap-2 font-semibold">
                <ShieldCheck className="text-brand" size={17} /> {statusLabel}
              </p>
            </div>
            <div className="rounded-md border border-line bg-surface p-3">
              <p className="text-sm text-muted">Должности</p>
              <p className="mt-1 font-semibold">{roleState.allRoles.map((role) => roleLabels[role] ?? role).join(", ") || "Не назначена"}</p>
            </div>
          </div>
        </section>

        {quality ? (
          <section className="mt-4 ui-panel p-4">
            <TaskQualityScore href="/tasks/quality" quality={quality} />
            <p className="mt-3 text-xs leading-5 text-muted">Учитываются персональные задачи, срок которых наступил за последние 30 дней. Задачи на магазин, без срока и отменённые не входят в расчёт. Поздно выполненная задача считается просроченной.</p>
          </section>
        ) : null}

        <section className="mt-4 ui-panel p-4">
          <h2 className="font-semibold">Безопасность</h2>
          <Link className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white" href="/profile/password">
            <KeyRound size={17} /> Сменить пароль
          </Link>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
