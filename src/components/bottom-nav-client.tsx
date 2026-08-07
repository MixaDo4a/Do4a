"use client";

import { BadgePercent, Bell, CalendarClock, ClipboardCheck, Home, ListTodo, PackageSearch, Settings, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const navGridRef = useRef<HTMLDivElement | null>(null);
  const navItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const hasUnreadNotifications = unreadCount > 0;
  const auditorOnly = roles.includes("auditor") && !roles.some((role) => managementRoles.includes(role));
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !roles.some((role) => managementRoles.includes(role));
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !roles.some((role) => managementRoles.includes(role));
  const buyerOnly = roles.includes("buyer") && !roles.some((role) => managementRoles.includes(role));
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));

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

  const activeIndex = useMemo(() => resolveActiveIndex(pathname, visibleItems), [pathname, visibleItems]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const container = navGridRef.current;
      const activeElement = navItemRefs.current[activeIndex];

      if (!container || !activeElement) {
        setIndicatorStyle(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeElement.getBoundingClientRect();

      setIndicatorStyle({
        left: activeRect.left - containerRect.left,
        width: activeRect.width,
      });
    };

    updateIndicator();

    if (typeof window === "undefined") {
      return;
    }

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(updateIndicator) : null;
    if (resizeObserver && navGridRef.current) {
      resizeObserver.observe(navGridRef.current);
    }

    window.addEventListener("resize", updateIndicator);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [activeIndex, visibleItems.length]);

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

      router.push(visibleItems[nextIndex].href);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pathname, router, visibleItems]);

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[#090607]/78 px-2 pt-2 backdrop-blur-2xl" style={{ touchAction: "pan-y" }}>
      <div
        ref={navGridRef}
        className="relative mx-auto grid max-w-[390px] gap-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {indicatorStyle ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-0 rounded-[18px] bg-brand shadow-[0_10px_28px_rgba(193,18,31,0.45),0_0_22px_rgba(255,57,72,0.24)] transition-[left,width,transform] duration-300 ease-out"
            style={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
            }}
          />
        ) : null}
        {visibleItems.map((item, index) => {
          const active = pathname === item.href || (item.href !== "/" && item.href !== "/checklists" && pathname.startsWith(item.href));
          const Icon = item.href === "/procurement" && managerOnly ? BadgePercent : item.icon;
          const label = warehouseManagerOnly && item.href === "/admin" ? "Вычеты" : item.href === "/procurement" && managerOnly ? "Акции" : item.label;
          const isNotifications = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              ref={(element) => {
                navItemRefs.current[index] = element;
              }}
              className={`bottom-nav-item relative z-10 flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition ${
                active ? "bottom-nav-item-active text-white" : "text-muted"
              }`}
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




