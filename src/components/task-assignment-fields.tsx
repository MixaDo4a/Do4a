"use client";

import { useState } from "react";

type StoreOption = { id: string; name: string };
type EmployeeOption = { id: string; fullName: string; storeIds: string[] };

type Props = {
  stores: StoreOption[];
  employees: EmployeeOption[];
  initialStoreId: string;
  initialAssigneeId: string;
};

export function TaskAssignmentFields({ stores, employees, initialStoreId, initialAssigneeId }: Props) {
  const [storeId, setStoreId] = useState(initialStoreId);
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId);
  const storeEmployees = employees.filter((employee) => employee.storeIds.includes(storeId));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">
        <span>Магазин</span>
        <select className="h-11 rounded-md border border-line px-3" name="store_id" onChange={(event) => {
          setStoreId(event.target.value);
          setAssigneeId("");
        }} value={storeId}>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        <span>Ответственный</span>
        <select className="h-11 rounded-md border border-line px-3" name="assignee_employee_id" onChange={(event) => setAssigneeId(event.target.value)} value={assigneeId}>
          <option value="">Не назначен</option>
          {storeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}
        </select>
      </label>
    </div>
  );
}
