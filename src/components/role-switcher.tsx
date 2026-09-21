import { Check, ChevronDown } from "lucide-react";
import { ROLE_HIERARCHY } from "@/lib/auth/role-constants";

const roleLabels: Record<string, string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  buyer: "Закупщик",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-админ",
  developer: "Разработчик",
};

export function RoleSwitcher({ activeRole, roles }: { activeRole: string | null; roles: string[] }) {
  if (roles.length <= 1) {
    return <p className="mt-1 text-sm text-muted">{roleLabels[activeRole ?? ""] ?? "Роль не назначена"}</p>;
  }

  const orderedRoles = [...roles].sort((left, right) => ROLE_HIERARCHY.indexOf(left as never) - ROLE_HIERARCHY.indexOf(right as never));

  return (
    <details className="relative mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-semibold text-brand">
        {roleLabels[activeRole ?? ""] ?? "Выбрать роль"} <ChevronDown size={14} />
      </summary>
      <div className="absolute left-0 top-full z-40 mt-2 min-w-52 ui-panel p-1 shadow-soft">
        {orderedRoles.map((role) => (
          <form action="/role/switch" key={role} method="post">
            <input name="role" type="hidden" value={role} />
            <button className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface" type="submit">
              {roleLabels[role] ?? role}
              {role === activeRole ? <Check size={15} className="text-brand" /> : null}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
