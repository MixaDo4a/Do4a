"use client";

import { BadgePercent, Bell, CalendarClock, ClipboardCheck, Home, ListTodo, PackageSearch, Settings, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
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

type TouchPoint = {
  x: number;
  y: number;
};

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
  const router = useRouter();
  const touchStartRef = useRef<TouchPoint | null>(null);
  const hasUnreadNotifications = unreadCount > 0;
  const auditorOnly = roles.includes("auditor") && !roles.some((role) => managementRoles.includes(role));
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !roles.some((role) => managementRoles.includes(role));
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !roles.some((role) => managementRoles.includes(role));
  const buyerOnly = roles.includes("buyer") && !roles.some((role) => managementRoles.includes(role));
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));

  const navigateWithTransition = useCallback(
    (href: string) => {
      if (href === pathname) {
        return;
      }

      const transition = (document as Document & {
        startViewTransition?: (callback: () => void) => ViewTransition;
      }).startViewTransition;
      if (typeof transition === "function") {
        transition.call(document, () => {
          router.push(href);
        });
        return;
      }

      router.push(href);
    },
    [pathname, router],
  );

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
    [auditorOnly, buyerOnly, managerOnly, roles, warehouseAssistantOnly, warehouseManagerOnly],
  );

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStartRef.current = null;
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, label, [contenteditable='true']")) {
        touchStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;

      if (!start || event.changedTouches.length !== 1) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;

      if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) {
        return;
      }

      const currentIndex = resolveActiveIndex(pathname, visibleItems);
      const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;

      if (nextIndex < 0 || nextIndex >= visibleItems.length) {
        return;
      }

      navigateWithTransition(visibleItems[nextIndex].href);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [navigateWithTransition, pathname, visibleItems]);

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[#090607]/78 px-2 pt-2 backdrop-blur-2xl" style={{ touchAction: "pan-y" }}>
      <div
        className="mx-auto grid max-w-[390px] gap-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && item.href !== "/checklists" && pathname.startsWith(item.href));
          const Icon = item.href === "/procurement" && managerOnly ? BadgePercent : item.icon;
          const label = warehouseManagerOnly && item.href === "/admin" ? "Вычеты" : item.href === "/procurement" && managerOnly ? "Акции" : item.label;
          const isNotifications = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              className={`bottom-nav-item relative flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition ${
                active ? "bottom-nav-item-active bg-brand text-white shadow-[0_8px_24px_rgba(193,18,31,0.42)]" : "text-muted"
              }`}
              style={{ overflow: "visible" }}
              href={item.href}
              prefetch
              onClick={(event) => {
                event.preventDefault();
                navigateWithTransition(item.href);
              }}
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




