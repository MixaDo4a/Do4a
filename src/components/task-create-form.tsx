"use client";

import { useMemo, useState } from "react";
import { TaskVoiceDescription } from "@/components/task-voice-description";

type StoreOption = { id: string; name: string; isWarehouse: boolean };
type EmployeeOption = { id: string; name: string; roles: string[] };

export function TaskCreateForm({ stores, employees }: { stores: StoreOption[]; employees: EmployeeOption[] }) {
  const [kind, setKind] = useState("ordinary");
  const storesForCampaign = stores.filter((store) => !store.isWarehouse);
  const auditors = useMemo(() => employees.filter((employee) => employee.roles.includes("auditor")), [employees]);
  const marketers = useMemo(() => employees.filter((employee) => employee.roles.includes("marketer")), [employees]);

  return (
    <form action="/tasks/create" className="mt-4 grid gap-3" method="post">
      <label className="grid gap-1 text-sm font-medium">
        <span>Тип задачи</span>
        <select className="h-11 rounded-md border border-line px-3" name="task_type" onChange={(event) => setKind(event.target.value)} value={kind}>
          <option value="ordinary">Обычная задача</option>
          <option value="expiration">Сроковая кампания</option>
        </select>
      </label>

      {kind === "ordinary" ? (
        <>
          <input className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand" name="title" placeholder="Название" required />
          <TaskVoiceDescription />
          <label className="grid gap-1 text-sm font-medium">
            <span>Подзадачи</span>
            <textarea className="min-h-24 rounded-md border border-line px-3 py-2 font-normal" name="ordinary_subtasks" placeholder={"Каждая подзадача с новой строки\nНапример: Подготовить материалы"} maxLength={5000} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="rounded-md border border-line p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">Магазины</legend>
              <p className="mt-1 text-xs text-muted">Можно выбрать несколько магазинов.</p>
              <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
                {stores.map((store) => <label key={store.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm"><input className="h-4 w-4 accent-brand" name="store_ids" type="checkbox" value={store.id} /><span>{store.name}</span></label>)}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-line p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">Ответственные продавцы</legend>
              <div className="mt-2 grid max-h-48 gap-2 overflow-auto">
                <label className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm"><input className="h-4 w-4" name="assignee_employee_ids" type="checkbox" value="__store_all__" /><span>Все сотрудники магазина</span></label>
                {employees.filter((employee) => employee.roles.includes("manager")).map((employee) => <label key={employee.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm"><input className="h-4 w-4" name="assignee_employee_ids" type="checkbox" value={employee.id} /><span>{employee.name}</span></label>)}
              </div>
            </fieldset>
            <input className="h-11 rounded-md border border-line px-3" name="due_at" type="datetime-local" />
            <select className="h-11 rounded-md border border-line px-3" name="priority" defaultValue="normal"><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select>
            <select className="h-11 rounded-md border border-line px-3 sm:col-span-2" name="recurrence_frequency" defaultValue="none"><option value="none">Без повторения</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option><option value="monthly">Каждый месяц</option></select>
          </div>
          <p className="text-xs text-muted">Если ответственный не выбран, задача назначается всем сотрудникам выбранных магазинов.</p>
        </>
      ) : (
        <div className="grid gap-3 rounded-md border border-line p-3">
          <label className="grid gap-1 text-sm"><span>Наименование товара</span><input className="h-11 rounded-md border border-line px-3" name="product_name" required /></label>
          <label className="grid gap-1 text-sm"><span>Срок годности</span><input className="h-11 rounded-md border border-line px-3" name="expiry_date" type="date" required /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="h-11 rounded-md border border-line px-3" name="discount_type" defaultValue="percent"><option value="percent">Скидка, %</option><option value="new_price">Новая цена, ₽</option></select>
            <input className="h-11 rounded-md border border-line px-3" min="0" name="discount_value" placeholder="Размер скидки или цена" step="0.01" type="number" required />
          </div>
          <p className="rounded-md bg-surface p-3 text-sm text-muted">Отдельные задачи автоматически появятся во всех доступных вам магазинах, кроме складов. Срок каждой задачи — до конца дня после указанного срока годности.</p>
          <label className="grid gap-1 text-sm"><span>Проверяющий</span><select className="h-11 rounded-md border border-line px-3" name="auditor_employee_id" required defaultValue=""><option disabled value="">Выберите проверяющего</option>{auditors.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span>Маркетолог</span><select className="h-11 rounded-md border border-line px-3" name="marketer_employee_id" required defaultValue=""><option disabled value="">Выберите маркетолога</option>{marketers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span>Дополнительные подзадачи для магазинов</span><textarea className="min-h-24 rounded-md border border-line p-3" name="extra_subtasks" placeholder="Одна подзадача на строку" /></label>
          {auditors.length === 0 || marketers.length === 0 ? <p className="rounded-md bg-surface p-3 text-sm text-muted">Для кампании назначьте сотрудников с ролями «Проверяющий» и «Маркетолог» в выбранных магазинах.</p> : null}
        </div>
      )}

      <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white" disabled={kind === "expiration" && (storesForCampaign.length === 0 || auditors.length === 0 || marketers.length === 0)}>Создать задачу</button>
    </form>
  );
}
