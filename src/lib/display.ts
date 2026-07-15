const employeeNameById: Record<string, string> = {
  "20000000-0000-0000-0000-000000000001": "Артем",
  "20000000-0000-0000-0000-000000000002": "Стас",
  "20000000-0000-0000-0000-000000000003": "Проверяющий",
  "20000000-0000-0000-0000-000000000004": "Управляющий",
  "20000000-0000-0000-0000-000000000005": "Супер Админ",
  "20000000-0000-0000-0000-000000000006": "Разработчик",
};

export function isBrokenText(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return value.includes("????") || value.includes("Рџ") || value.includes("СЃ") || value.includes("В·");
}

export function cleanText(value: string | null | undefined, fallback: string) {
  if (!value || isBrokenText(value)) {
    return fallback;
  }

  return value;
}

export function employeeName(employee: { id?: string | null; full_name?: string | null } | null | undefined) {
  if (!employee) {
    return "Сотрудник";
  }

  if (employee.id && employeeNameById[employee.id]) {
    return employeeNameById[employee.id];
  }

  return cleanText(employee.full_name, "Сотрудник");
}

