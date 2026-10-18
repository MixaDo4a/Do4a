"use client";

import { SCHEDULE_STATUS_OPTIONS } from "@/lib/schedule-status";

type ScheduleStatusSelectProps = {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
};

export function ScheduleStatusSelect({ name, value, onValueChange }: ScheduleStatusSelectProps) {
  return (
    <select
      aria-label="Статус смены"
      className="schedule-status-select"
      data-status={value || "empty"}
      name={name}
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      <option value="">—</option>
      {SCHEDULE_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
