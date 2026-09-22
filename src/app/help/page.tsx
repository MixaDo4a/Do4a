import Link from "next/link";
import { BookOpen, ChevronLeft, CircleHelp } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { helpRoleLabels, helpSectionsByRole, normalizeHelpRole } from "@/lib/help-content";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { user, activeRole, allRoles } = await getCurrentRoleCodes();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const selectedRole = normalizeHelpRole(params.role && allRoles.includes(params.role) ? params.role : activeRole);
  const sections = helpSectionsByRole[selectedRole];

  return (
    <main className="app-shell min-h-dvh bg-surface text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-24 pt-4 sm:px-6 lg:px-8">
        <header className="ui-panel p-4">
          <Link className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink" href="/"><ChevronLeft size={17} /> На главную</Link>
          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><BookOpen size={22} /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Do4a Staff Only</p>
              <h1 className="text-2xl font-semibold">Инструкция</h1>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">Разделы и подсказки для интерфейса: {helpRoleLabels[selectedRole]}.</p>
          {allRoles.length > 1 ? <div className="mt-4 flex flex-wrap gap-2">{allRoles.map((role) => <Link className={`rounded-md border px-3 py-2 text-xs font-semibold ${role === selectedRole ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"}`} href={`/help?role=${role}`} key={role}>{helpRoleLabels[normalizeHelpRole(role)]}</Link>)}</div> : null}
        </header>

        <section className="mt-4 grid gap-3">
          {sections.map((section) => (
            <article className="ui-panel p-4" key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{section.description}</p>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-ink">{section.items.map((item) => <li className="flex gap-2" key={item}><CircleHelp className="mt-1 shrink-0 text-brand" size={15} /><span>{item}</span></li>)}</ul>
            </article>
          ))}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
