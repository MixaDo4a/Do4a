import { Banknote, ClipboardList, Gift, LayoutList, WalletCards } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const links = [
  { href: "/payroll", title: "Зарплата", description: "Расчёт и выплаты сотрудникам", icon: WalletCards },
  { href: "/admin", title: "Премии и штрафы", description: "Корректировки зарплаты", icon: Gift },
  { href: "/admin", title: "План на магазин", description: "Планы продаж по магазинам", icon: LayoutList },
  { href: "/cash", title: "Наличные в кассе", description: "Остатки, РКО и ПКО", icon: Banknote },
];

export default async function FinancesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, [...MANAGE_ROLES, "manager", "auditor"])) redirect("/");

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={ClipboardList} title="Финансы" showBack />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {links.map(({ href, title, description, icon: Icon }) => (
            <Link key={title} className="ui-panel p-4 transition hover:border-brand/60" href={href}>
              <div className="flex items-center gap-3">
                <Icon className="text-brand" size={22} />
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-muted">{description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
