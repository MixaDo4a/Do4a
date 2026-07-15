"use client";

import { Bell, ClipboardCheck, Home, ListTodo, Settings, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const managementRoles = ["manager", "store_manager", "super_admin", "developer"];

const items = [
  { href: "/", label: "Главная", icon: Home, roles: null, hideForAuditorOnly: false },
  { href: "/shifts", label: "Смены", icon: ShieldCheck, roles: null, hideForAuditorOnly: true },
  { href: "/tasks", label: "Задачи", icon: ListTodo, roles: null, hideForAuditorOnly: false },
  {
    href: "/checklists",
    label: "Архив",
    icon: ClipboardCheck,
    roles: ["auditor", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
  {
    href: "/checklists/new",
    label: "Чек",
    icon: ClipboardCheck,
    roles: ["auditor", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
  { href: "/payroll", label: "ЗП", icon: WalletCards, roles: null, hideForAuditorOnly: true },
  { href: "/notifications", label: "Увед.", icon: Bell, roles: null, hideForAuditorOnly: false },
  {
    href: "/admin",
    label: "Упр.",
    icon: Settings,
    roles: ["store_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    let ignore = false;

    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!ignore && Array.isArray(data?.roles)) {
          setRoles(data.roles);
        }
      })
      .catch(() => {
        if (!ignore) {
          setRoles([]);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const auditorOnly = roles.includes("auditor") && !roles.some((role) => managementRoles.includes(role));
  const visibleItems = items.filter((item) => {
    if (auditorOnly && item.hideForAuditorOnly) {
      return false;
    }

    return !item.roles || item.roles.some((role) => roles.includes(role));
  });

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[#090607]/94 px-2 pt-2 backdrop-blur-xl">
      <div
        className="mx-auto grid max-w-[390px] gap-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && item.href !== "/checklists" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition ${
                active
                  ? "bg-brand text-white shadow-[0_8px_24px_rgba(193,18,31,0.42)]"
                  : "text-muted"
              }`}
              href={item.href}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

