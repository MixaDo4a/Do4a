"use client";

import { useState } from "react";
import { SCHEDULE_STATUS_OPTIONS } from "@/lib/schedule-status";

type ScheduleStatusSelectProps = {
  name: string;
  defaultValue?: string | null;
};

export function ScheduleStatusSelect({ name, defaultValue }: ScheduleStatusSelectProps) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <select
      aria-label="Статус смены"
      className="schedule-status-select"
      data-status={value || "empty"}
      name={name}
      onChange={(event) => setValue(event.target.value)}
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
