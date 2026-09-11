"use client";

import { usePathname } from "next/navigation";

type BackgroundMapItem = {
  match: string[];
  src: string;
};

const ROUTE_BACKGROUNDS: BackgroundMapItem[] = [

  { match: ["/"], src: "/page-bgs/home.webp" },
  { match: ["/shifts"], src: "/page-bgs/shifts.webp" },
  { match: ["/tasks/archive"], src: "/page-bgs/archive.webp" },
  { match: ["/tasks"], src: "/page-bgs/tasks.webp" },
  { match: ["/routine/archive"], src: "/page-bgs/archive.webp" },
  { match: ["/routine"], src: "/page-bgs/routine.webp" },
  { match: ["/checklists/new", "/checklists/"], src: "/page-bgs/checklist.webp" },
  { match: ["/checklists"], src: "/page-bgs/archive.webp" },
  { match: ["/payroll"], src: "/page-bgs/payroll.webp" },
  { match: ["/procurement"], src: "/page-bgs/procurement.webp" },
  { match: ["/notifications"], src: "/page-bgs/notifications-admin.webp" },
  { match: ["/admin"], src: "/page-bgs/notifications-admin.webp" },
  { match: ["/cash"], src: "/page-bgs/notifications-admin.webp" },
  { match: ["/schedule"], src: "/page-bgs/routine.webp" },
];

function resolveBackground(pathname: string) {
  for (const item of ROUTE_BACKGROUNDS) {
    if (item.match.some((pattern) => (pattern === "/" ? pathname === "/" : pathname.startsWith(pattern)))) {
      return item.src;
    }
  }

  return null;
}

export function RouteBackground() {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/auth")) {
    return null;
  }

  const src = resolveBackground(pathname);
  if (!src) {
    return null;
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-transparent">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-100"
        style={{ backgroundImage: `url(${src})` }}
      />
    </div>
  );
}
