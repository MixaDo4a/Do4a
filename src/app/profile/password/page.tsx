import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ChangePasswordPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={KeyRound} title="Сменить пароль" showBack />
        <section className="mt-4 ui-panel p-4">
          <form action="/profile/password/update" className="grid gap-3" method="post">
            <label className="grid gap-1 text-sm">
              <span>Текущий пароль</span>
              <input autoComplete="current-password" className="h-11 rounded-md border border-line px-3" name="current_password" required type="password" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Новый пароль</span>
              <input autoComplete="new-password" className="h-11 rounded-md border border-line px-3" minLength={8} name="new_password" required type="password" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Повторите новый пароль</span>
              <input autoComplete="new-password" className="h-11 rounded-md border border-line px-3" minLength={8} name="confirm_password" required type="password" />
            </label>
            <button className="mt-1 h-11 rounded-md bg-brand px-4 font-semibold text-white" type="submit">Сохранить новый пароль</button>
          </form>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
