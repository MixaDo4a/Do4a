import Link from "next/link";
import type { TaskQuality } from "@/lib/task-quality";

export function TaskQualityScore({ quality, compact = false, href }: { quality: TaskQuality; compact?: boolean; href?: string }) {
  return (
    <div className={compact ? "text-xs" : "rounded-md border border-line bg-surface p-4"}>
      <p className={compact ? "text-muted" : "text-sm text-muted"}>Качество выполнения задач · 30 дней</p>
      <p className={compact ? "mt-1 font-semibold text-ink" : "mt-2 text-2xl font-semibold text-ink"}>
        {quality.percentage === null ? "Пока нет оценки" : href ? (
          <Link className="underline decoration-brand/60 underline-offset-4 hover:text-brand" href={href}>
            {quality.percentage}%
          </Link>
        ) : `${quality.percentage}%`}
      </p>
      {quality.totalCount ? (
        <p className="mt-1 text-muted">В срок: {quality.onTimeCount} из {quality.totalCount}</p>
      ) : null}
    </div>
  );
}
