"use client";

import { BadgePercent, Bell, CalendarClock, ClipboardCheck, Home, ListTodo, PackageSearch, Settings, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, type CSSProperties } from "react";
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
    label: "Закуп/Акции",
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
  { href: "/payroll", label: "ЗП", icon: WalletCards, roles: ["manager"], hideForAuditorOnly: false },
  { href: "/finances", label: "Финансы", icon: WalletCards, roles: null, hideForAuditorOnly: true },
  { href: "/notifications", label: "Увед.", icon: Bell, roles: null, hideForAuditorOnly: false },
  {
    href: "/admin",
    label: "Упр.",
    icon: Settings,
    roles: ["store_manager", "warehouse_manager", "super_admin", "developer"],
    hideForAuditorOnly: false,
  },
];

function resolveActiveIndex(pathname: string, navItems: BottomNavItem[]) {
  let bestIndex = 0;
  let bestLength = -1;

  for (let index = 0; index < navItems.length; index += 1) {
    const item = navItems[index];
    const matches =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

    if (matches && item.href.length > bestLength) {
      bestIndex = index;
      bestLength = item.href.length;
    }
  }

  return bestIndex;
}

export function BottomNavClient({ roles, unreadCount }: { roles: string[]; unreadCount: number }) {
  const pathname = usePathname();
  const hasUnreadNotifications = unreadCount > 0;
  const auditorOnly = roles.includes("auditor") && !roles.some((role) => managementRoles.includes(role));
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !roles.some((role) => managementRoles.includes(role));
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !roles.some((role) => managementRoles.includes(role));
  const buyerOnly = roles.includes("buyer") && !roles.some((role) => managementRoles.includes(role));
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));
  const managementView = roles.some((role) => ["store_manager", "super_admin"].includes(role));

  useEffect(() => {
    let cancelled = false;

    void registerPushServiceWorker();

    const runRoutineChecks = async () => {
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
        ]);
      } catch {
        // Ignore transient network errors. The server-side routine function has its own dedupe log.
      }
    };

    const runPushSync = async () => {
      try {
        await fetch("/api/push/sync", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
        });
      } catch {
        // Ignore transient network errors. Push sync is retried on the next interval.
      }
    };

    void runRoutineChecks();
    const pushSyncTimer = window.setTimeout(() => {
      if (!cancelled) {
        void runPushSync();
      }
    }, 30_000);

    const timer = window.setInterval(() => {
      if (!cancelled) {
        void runPushSync();
      }
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(pushSyncTimer);
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
        if (warehouseManagerOnly && ["/shifts", "/checklists", "/checklists/new", "/finances"].includes(item.href)) {
          return false;
        }
        if (warehouseAssistantOnly && !["/", "/tasks", "/payroll", "/notifications"].includes(item.href)) {
          return false;
        }
        if (buyerOnly && !["/", "/procurement", "/notifications"].includes(item.href)) {
          return false;
        }
        if (managerOnly && ["/shifts", "/routine"].includes(item.href)) {
          return false;
        }
        if (managerOnly && item.href === "/finances") {
          return false;
        }
        if (managementView && ["/shifts", "/routine", "/procurement", "/checklists", "/checklists/new"].includes(item.href)) {
          return false;
        }

        return !item.roles || item.roles.some((role) => roles.includes(role));
      }),
    [auditorOnly, buyerOnly, managerOnly, managementView, roles, warehouseAssistantOnly, warehouseManagerOnly],
  );

  const activeIndex = useMemo(() => resolveActiveIndex(pathname, visibleItems), [pathname, visibleItems]);

  const navGridStyle = {
    gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))`,
    "--bottom-nav-active-x": `calc((100% / ${visibleItems.length}) * ${activeIndex + 0.5})`,
  } as CSSProperties;

  return (
    <nav className="bottom-nav-shell px-2 pt-2" data-tour="bottom-nav" style={{ touchAction: "pan-y" }}>
      <div
        className="bottom-nav-grid relative mx-auto grid max-w-[390px] gap-0"
        style={navGridStyle}
      >
        <div
          aria-hidden="true"
          className="bottom-nav-indicator pointer-events-none absolute z-0 transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: `calc((100% / ${visibleItems.length}) * ${activeIndex + 0.5})` }}
        >
          <span className="bottom-nav-indicator-circle" />
        </div>
        {visibleItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && item.href !== "/checklists" && pathname.startsWith(item.href));
          const Icon = item.href === "/procurement" && managerOnly ? BadgePercent : item.icon;
          const label = warehouseManagerOnly && item.href === "/admin" ? "Вычеты" : item.href === "/procurement" && managerOnly ? "Акции" : item.label;
          const isNotifications = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              className={`bottom-nav-item relative z-10 flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition ${
                active ? "bottom-nav-item-active text-white" : "text-muted"
              }`}
              data-tour={`nav-${item.href === "/" ? "home" : item.href.slice(1).replaceAll("/", "-")}`}
              style={{ overflow: "visible" }}
              href={item.href}
              prefetch
            >
              <span
                className={`bottom-nav-icon relative inline-flex h-6 w-6 shrink-0 items-center justify-center ${
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
              <span className="bottom-nav-label">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}




