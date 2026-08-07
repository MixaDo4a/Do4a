"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type BackgroundMapItem = {
  match: string[];
  src: string;
};

const ROUTE_BACKGROUNDS: BackgroundMapItem[] = [

  { match: ["/"], src: "/page-bgs/home.png" },
  { match: ["/shifts"], src: "/page-bgs/shifts.png" },
  { match: ["/tasks/archive"], src: "/page-bgs/archive.png" },
  { match: ["/tasks"], src: "/page-bgs/tasks.png" },
  { match: ["/routine/archive"], src: "/page-bgs/archive.png" },
  { match: ["/routine"], src: "/page-bgs/routine.png" },
  { match: ["/checklists/new", "/checklists/"], src: "/page-bgs/checklist.png" },
  { match: ["/checklists"], src: "/page-bgs/archive.png" },
  { match: ["/payroll"], src: "/page-bgs/payroll.png" },
  { match: ["/procurement"], src: "/page-bgs/procurement.png" },
  { match: ["/notifications"], src: "/page-bgs/notifications-admin.png" },
  { match: ["/admin"], src: "/page-bgs/notifications-admin.png" },
  { match: ["/cash"], src: "/page-bgs/notifications-admin.png" },
  { match: ["/schedule"], src: "/page-bgs/routine.png" },
];

const PRELOADED_BACKGROUNDS = new Set<string>();

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    for (const item of ROUTE_BACKGROUNDS) {
      if (PRELOADED_BACKGROUNDS.has(item.src)) {
        continue;
      }

      const image = new window.Image();
      image.decoding = "async";
      image.src = item.src;
      PRELOADED_BACKGROUNDS.add(item.src);
    }
  }, []);

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
