"use client";

import Link from "next/link";
import { useState } from "react";

export type PayrollFilterStore = { id: string; name: string; city: string };
export type PayrollFilterEmployee = { id: string; name: string; storeIds: string[] };

type Props = {
  month: string;
  stores: PayrollFilterStore[];
  employees: PayrollFilterEmployee[];
  initialCity: string;
  initialStoreId: string;
  initialEmployeeId: string;
};

export function PayrollFilters({ month, stores, employees, initialCity, initialStoreId, initialEmployeeId }: Props) {
  const [city, setCity] = useState(initialCity);
  const [storeId, setStoreId] = useState(initialStoreId);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const cities = [...new Set(stores.map((store) => store.city))].sort((a, b) => a.localeCompare(b, "ru"));
  const availableStores = stores.filter((store) => !city || store.city === city);
  const availableStoreIds = new Set(availableStores.map((store) => store.id));
  const availableEmployees = employees.filter((employee) => {
    if (!city && !storeId) return true;
    return employee.storeIds.some((id) => storeId ? id === storeId : availableStoreIds.has(id));
  });

  return (
    <form action="/payroll" className="mt-4 grid gap-3 sm:grid-cols-3" method="get">
      <input name="period" type="hidden" value={month} />
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Город</span>
        <select className="h-11 min-w-0 px-3" name="city" onChange={(event) => {
          setCity(event.target.value);
          setStoreId("");
          setEmployeeId("");
        }} value={city}>
          <option value="">Все города</option>
          {cities.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Магазин</span>
        <select className="h-11 min-w-0 px-3" name="storeId" onChange={(event) => {
          setStoreId(event.target.value);
          setEmployeeId("");
        }} value={storeId}>
          <option value="">Все магазины</option>
          {availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Сотрудник</span>
        <select className="h-11 min-w-0 px-3" name="filterEmployeeId" onChange={(event) => setEmployeeId(event.target.value)} value={employeeId}>
          <option value="">Все сотрудники</option>
          {availableEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Показать</button>
        <Link className="text-sm text-muted underline-offset-4 hover:underline" href={`/payroll?period=${month}`}>Сбросить фильтры</Link>
      </div>
    </form>
  );
}
