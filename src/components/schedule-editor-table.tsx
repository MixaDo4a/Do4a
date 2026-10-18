"use client";

import { useState } from "react";
import { ScheduleStatusSelect } from "@/components/schedule-status-select";

type ScheduleDate = {
  date: string;
  label: string;
  dayName: string;
  isWeekend: boolean;
};

type Props = {
  employees: { id: string; name: string }[];
  dates: ScheduleDate[];
  initialEmployeeIds: (string | null)[];
  initialStatuses: Record<string, Record<string, string>>;
};

export function ScheduleEditorTable({ employees, dates, initialEmployeeIds, initialStatuses }: Props) {
  const [employeeIds, setEmployeeIds] = useState(initialEmployeeIds);
  const [statuses, setStatuses] = useState(initialStatuses);

  return (
    <div className="schedule-editor-frame">
      <div className="schedule-editor-scroll">
        <table className="schedule-editor-table">
          <thead>
            <tr>
              <th className="schedule-editor-sticky schedule-editor-employee-head">Сотрудник</th>
              {dates.map((cell) => (
                <th key={cell.date} className={cell.isWeekend ? "schedule-editor-day schedule-editor-weekend" : "schedule-editor-day"}>
                  <span>{cell.dayName}</span>
                  <strong>{cell.label}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employeeIds.map((employeeId, index) => (
              <tr key={index}>
                <td className="schedule-editor-sticky schedule-editor-employee-cell">
                  <select
                    aria-label={`Сотрудник в строке ${index + 1}`}
                    name={`employee_row_${index}`}
                    onChange={(event) => {
                      const next = [...employeeIds];
                      next[index] = event.target.value || null;
                      setEmployeeIds(next);
                    }}
                    value={employeeId ?? ""}
                  >
                    <option value="">—</option>
                    {employees.map((employee) => (
                      <option key={employee.id} disabled={employeeIds.some((id, row) => row !== index && id === employee.id)} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </td>
                {dates.map((cell) => (
                  <td key={cell.date} className="schedule-editor-cell">
                    <ScheduleStatusSelect
                      name={`cell_row_${index}_${cell.date}`}
                      onValueChange={(status) => {
                        if (!employeeId) return;
                        setStatuses((current) => ({
                          ...current,
                          [employeeId]: { ...current[employeeId], [cell.date]: status },
                        }));
                      }}
                      value={employeeId ? statuses[employeeId]?.[cell.date] ?? "" : ""}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
