"use client";

import { Bell, CalendarClock, ClipboardCheck, Home, ListTodo, PackageSearch, Settings, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { PROCUREMENT_ROLES } from "@/lib/auth/role-constants";
import { registerPushServiceWorker } from "@/lib/push-client";

type BottomNavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  roles: string[] | null;
  hideForAuditorOnly: boolean;
};

const managementRoles = ["manager", "store_manager", "super_admin", "developer"];

const items: BottomNavItem[] = [
  { href: "/", label: "Главная", icon: Home, roles: null, hideForAuditorOnly: false },
  { href: "/shifts", label: "Смены", icon: ShieldCheck, roles: null, hideForAuditorOnly: true },
  { href: "/tasks", label: "Задачи", icon: ListTodo, roles: null, hideForAuditorOnly: false },
  {
    href: "/routine",
    label: "Распор.",
    icon: CalendarClock,
    roles: ["manager", "store_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
  {
    href: "/procurement",
    label: "Закуп",
    icon: PackageSearch,
    roles: PROCUREMENT_ROLES,
    hideForAuditorOnly: false,
  },
  {
    href: "/checklists",
    label: "Архив",
    icon: ClipboardCheck,
    roles: ["auditor", "store_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
  {
    href: "/checklists/new",
    label: "Чек",
    icon: ClipboardCheck,
    roles: ["auditor", "store_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
  { href: "/payroll", label: "ЗП", icon: WalletCards, roles: null, hideForAuditorOnly: true },
  { href: "/notifications", label: "Увед.", icon: Bell, roles: null, hideForAuditorOnly: false },
  {
    href: "/admin",
    label: "Упр.",
    icon: Settings,
    roles: ["store_manager", "warehouse_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
];

export function BottomNavClient({ roles, unreadCount }: { roles: string[]; unreadCount: number }) {
  const pathname = usePathname();
  const hasUnreadNotifications = unreadCount > 0;
  const auditorOnly = roles.includes("auditor") && !roles.some((role) => managementRoles.includes(role));
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !roles.some((role) => managementRoles.includes(role));
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !roles.some((role) => managementRoles.includes(role));
  const buyerOnly = roles.includes("buyer") && !roles.some((role) => managementRoles.includes(role));

  useEffect(() => {
    let cancelled = false;

    void registerPushServiceWorker();

    const runMaintenanceChecks = async () => {
      try {
        await Promise.all([
          fetch("/api/routine/reminders", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
          }),
          fetch("/api/tasks/recurrences", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
          }),
          fetch("/api/push/sync", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
          }),
        ]);
      } catch {
        // Ignore transient network errors. The server-side routine function has its own dedupe log.
      }
    };

    void runMaintenanceChecks();
    const timer = window.setInterval(() => {
      if (!cancelled) {
        void runMaintenanceChecks();
      }
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const navigatorWithBadge = navigator as Navigator & {
      setAppBadge?: (contents?: number | undefined) => Promise<void> | void;
      clearAppBadge?: () => Promise<void> | void;
    };

    if (typeof navigatorWithBadge.setAppBadge === "function") {
      if (hasUnreadNotifications) {
        void navigatorWithBadge.setAppBadge(unreadCount);
      } else {
        void navigatorWithBadge.clearAppBadge?.();
      }
    }
  }, [hasUnreadNotifications, unreadCount]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (auditorOnly && item.hideForAuditorOnly) {
          return false;
        }
        if (warehouseManagerOnly && ["/shifts", "/checklists", "/checklists/new", "/payroll"].includes(item.href)) {
          return false;
        }
        if (warehouseAssistantOnly && !["/", "/tasks", "/payroll", "/notifications"].includes(item.href)) {
          return false;
        }
        if (buyerOnly && !["/", "/procurement", "/notifications"].includes(item.href)) {
          return false;
        }

        return !item.roles || item.roles.some((role) => roles.includes(role));
      }),
    [auditorOnly, buyerOnly, roles, warehouseAssistantOnly, warehouseManagerOnly],
  );

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[#090607]/94 px-2 pt-2 backdrop-blur-xl">
      <div
        className="mx-auto grid max-w-[390px] gap-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && item.href !== "/checklists" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const label = warehouseManagerOnly && item.href === "/admin" ? "Вычеты" : item.label;
          const isNotifications = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              className={`relative flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition ${
                active ? "bg-brand text-white shadow-[0_8px_24px_rgba(193,18,31,0.42)]" : "text-muted"
              }`}
              style={{ overflow: "visible" }}
              href={item.href}
              prefetch
            >
              <span
                className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center ${
                  isNotifications && hasUnreadNotifications ? "text-brand drop-shadow-[0_0_10px_rgba(255,57,72,0.7)]" : ""
                }`}
                style={{ overflow: "visible" }}
              >
                {isNotifications && hasUnreadNotifications ? (
                  <>
                    <span className="pointer-events-none absolute inset-[-0.5rem] rounded-full border border-brand/30 animate-[notification-wave_1.8s_ease-out_infinite]" />
                    <span className="pointer-events-none absolute inset-[-0.2rem] rounded-full border border-brand/20 animate-[notification-wave_1.8s_ease-out_infinite] [animation-delay:300ms]" />
                  </>
                ) : null}
                <Icon className="relative z-10" size={18} />
                {isNotifications && hasUnreadNotifications ? (
                  <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-30 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-white/20 bg-brand px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_12px_rgba(255,57,72,0.6)] ring-2 ring-[#090607]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

