import type { LucideIcon } from "lucide-react";

type MetricProps = {
  icon: LucideIcon;
  label: string;
  value: string;
};

export function Metric({ icon: Icon, label, value }: MetricProps) {
  return (
    <div className="ui-panel rounded-[24px] p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[18px] bg-surface text-brand shadow-soft">
          <Icon size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold text-[#f8f2eb]">{value}</p>
        </div>
      </div>
    </div>
  );
}
