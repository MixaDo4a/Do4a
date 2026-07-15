export const mockDashboard = {
  today: "Июль 2026",
  revenue: "78 937 ₽",
  checklistScore: "9,75",
  tasksOpen: "3 открыто",
  payrollPreview: "26 387 ₽",
  shift: {
    store: "Калинина",
    status: "Не открыта",
    autoClose: "23:59",
  },
  nextShift: {
    store: "Ленинградская",
    time: "Завтра, 10:00",
  },
  tasks: [
    { id: "1", title: "Проверить порядок на стеллажах", due: "Сегодня до 18:00" },
    { id: "2", title: "Загрузить фото витрины", due: "Сегодня до 20:00" },
  ],
};

export const mockShifts = [
  { id: "1", date: "3 июля", store: "Калинина", status: "Запланирована" },
  { id: "2", date: "4 июля", store: "Ленинградская", status: "Запланирована" },
  { id: "3", date: "5 июля", store: "Южный", status: "Выходной" },
];

export const mockTasks = [
  { id: "1", title: "Проверить остатки акционных товаров", store: "Калинина", priority: "Высокий", due: "30 мин", comments: 2, files: 0 },
  { id: "2", title: "Фотоотчет по витрине", store: "Ленинградская", priority: "Обычный", due: "Сегодня", comments: 0, files: 1 },
  { id: "3", title: "Разобрать поставку", store: "Южный", priority: "Обычный", due: "Завтра", comments: 1, files: 0 },
];

export const mockPayroll = {
  total: "96 510 ₽",
  base: "32 000 ₽",
  sales: "28 990 ₽",
  lines: [
    { label: "Продажная часть", value: "+28 990 ₽" },
    { label: "Надбавка за план", value: "+0 ₽" },
    { label: "Оклад", value: "+32 000 ₽" },
    { label: "Премия", value: "+36 000 ₽" },
    { label: "Аванс", value: "-0 ₽" },
    { label: "Просрочка", value: "-307 ₽" },
    { label: "Под ЗП", value: "-770 ₽" },
  ],
};

export const mockNotifications = [
  { id: "1", title: "Новая задача", body: "Проверить порядок на стеллажах", time: "5 минут назад" },
  { id: "2", title: "Напоминание о смене", body: "Смена на Ленинградской через 16 часов", time: "Сегодня" },
  { id: "3", title: "Закрытие смены", body: "До автозакрытия осталось 10 минут", time: "Вчера" },
];

