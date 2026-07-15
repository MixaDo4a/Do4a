import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { BackButton } from "@/components/back-button";

type SectionHeaderProps = {
  icon: LucideIcon;
  title: string;
  action?: string;
  href?: string;
  showBack?: boolean;
};

export function SectionHeader({ icon: Icon, title, action, href, showBack = false }: SectionHeaderProps) {
  const actionContent = action ? (
    href ? (
      <Link className="inline-flex h-10 items-center justify-center rounded-[18px] border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-soft" href={href}>
        {action}
      </Link>
    ) : (
      <button className="inline-flex h-10 items-center justify-center rounded-[18px] border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-soft" type="button">
        {action}
      </button>
    )
  ) : null;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {showBack ? <BackButton /> : null}
        <h2 className="inline-flex min-w-0 items-center gap-2 text-[1.02rem] font-semibold tracking-tight sm:text-[1.08rem]">
          <Icon className="shrink-0 text-brand drop-shadow-[0_0_14px_rgba(255,52,69,0.35)]" size={20} />
          <span className="truncate">{title}</span>
        </h2>
      </div>
      {actionContent}
    </div>
  );
}
