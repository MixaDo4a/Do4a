"use client";

import { Children, type ReactNode, useState } from "react";
import { Search } from "lucide-react";

type EmployeeSearchListProps = {
  employees: { id: string; name: string }[];
  children: ReactNode;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

export function EmployeeSearchList({ employees, children }: EmployeeSearchListProps) {
  const [query, setQuery] = useState("");
  const rows = Children.toArray(children);
  const normalizedQuery = normalize(query);
  const matches = employees.map((employee) => normalize(employee.name).includes(normalizedQuery));

  return (
    <>
      <label className="mt-4 flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-muted">
        <Search aria-hidden="true" size={18} />
        <input
          aria-label="Поиск сотрудника по имени"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени"
          type="search"
          value={query}
        />
      </label>
      <div className="mt-3 grid gap-3">
        {rows.map((row, index) => (
          <div hidden={!matches[index]} key={employees[index]?.id ?? index}>{row}</div>
        ))}
        {normalizedQuery && !matches.some(Boolean) ? (
          <p className="py-3 text-sm text-muted">Сотрудники не найдены.</p>
        ) : null}
      </div>
    </>
  );
}
