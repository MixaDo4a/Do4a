# Database Design

## Назначение

Документ описывает проект PostgreSQL-схемы для Supabase. Это не финальная миграция, а первая подробная ERD-спецификация MVP, на основании которой будут создаваться Supabase migrations, RLS-политики и backend-операции.

## Базовые принципы

- Основные идентификаторы: `uuid`.
- Денежные значения: `numeric(12,2)`.
- Проценты: `numeric(6,4)` или фиксированная бизнес-константа в расчетной функции.
- Даты без времени: `date`.
- Моменты событий: `timestamptz`.
- Все таблицы в `public` должны иметь RLS.
- Клиент не выполняет доверенные финансовые расчеты.
- Исторические данные не удаляются физически, если на них есть ссылки.
- Закрытые смены и payroll-результаты фиксируются через snapshots.
- Google Sheets не является источником истины после импорта данных в PostgreSQL.

## Общие технические поля

Для большинства бизнес-таблиц используются поля:

| Поле | Тип | Назначение |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `created_at` | `timestamptz` | Время создания записи. |
| `updated_at` | `timestamptz` | Время последнего изменения. |
| `created_by` | `uuid` | Пользователь, создавший запись. |
| `updated_by` | `uuid` | Пользователь, изменивший запись. |

Для справочников и сущностей с историей вместо удаления используется статус или архивирование.

## Enum-справочники

На уровне PostgreSQL или справочных таблиц нужны следующие значения.

### User role

- `manager`.
- `auditor`.
- `store_manager`.
- `super_admin`.
- `developer`.

### Employee status

- `padawan` - менеджер на испытательном сроке.
- `experienced` - менеджер, прошедший испытательный срок.

### Store status

- `active`.
- `archived`.

### Shift status

- `planned`.
- `opened`.
- `closed`.
- `auto_closed`.
- `cancelled`.
- `correction_required`.

### Shift source

- `schedule` - создана из графика.
- `manual_open` - открыта менеджером без графика.

### Shift participant role

- `primary_seller`.
- `secondary_seller`.

### Task status

- `open`.
- `in_progress`.
- `done`.
- `overdue`.
- `cancelled`.

### Notification channel

- `in_app`.
- `telegram`.
- `email`.

## Auth and access

### `profiles`

Профиль пользователя приложения, связанный с `auth.users` Supabase.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Совпадает с `auth.users.id`. |
| `employee_id` | `uuid` | нет | Связь с `employees.id`. |
| `telegram_user_id` | `bigint` | нет | Telegram user id. |
| `telegram_username` | `text` | нет | Telegram username. |
| `email` | `text` | нет | Резервный email. |
| `full_name` | `text` | да | Отображаемое имя. |
| `is_blocked` | `boolean` | да | Блокировка входа. |
| `last_login_at` | `timestamptz` | нет | Последний вход. |

Связи:

- `profiles.employee_id -> employees.id`.
- `profiles.id -> auth.users.id`.

Доступ:

- Пользователь читает свой профиль.
- Управляющий читает профили сотрудников в своей области.
- Супер-админ читает и меняет все профили.
- Разработчик не получает полный доступ автоматически.

### `roles`

Справочник ролей.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `code` | `text` | да | `manager`, `auditor`, `store_manager`, `super_admin`, `developer`. |
| `name` | `text` | да | Название роли. |
| `description` | `text` | нет | Описание. |
| `is_system` | `boolean` | да | Системная роль. |

Ограничения:

- `code` уникален.

### `user_roles`

Назначенные роли пользователей.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `profile_id` | `uuid` | да | Пользователь. |
| `role_id` | `uuid` | да | Роль. |
| `scope_store_id` | `uuid` | нет | Ограничение на магазин, если нужно. |
| `scope_city` | `text` | нет | Ограничение на город, если нужно. |
| `assigned_by` | `uuid` | да | Кто назначил роль. |
| `assigned_at` | `timestamptz` | да | Когда назначена. |
| `revoked_at` | `timestamptz` | нет | Когда отозвана. |

Правила:

- Управляющий может назначать только роль `manager`.
- Роль выше менеджера назначает только супер-админ.
- История назначения ролей сохраняется.

## Stores and employees

### `stores`

Магазины компании.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `city` | `text` | да | Город. |
| `name` | `text` | да | Название магазина. |
| `address` | `text` | нет | Адрес. |
| `timezone` | `text` | да | Часовой пояс магазина. |
| `workday_start_time` | `time` | нет | Начало рабочего дня. |
| `workday_end_time` | `time` | нет | Конец рабочего дня. |
| `status` | `text` | да | `active` или `archived`. |
| `archived_at` | `timestamptz` | нет | Когда архивирован. |

Ограничения:

- Магазин с историей не удаляется, а архивируется.
- `timezone` нужен для автозакрытия смен и уведомлений.

### `store_sales_plans`

Планы продаж магазина.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `period_start` | `date` | да | Начало периода. |
| `period_end` | `date` | да | Конец периода. |
| `sales_plan_amount` | `numeric(12,2)` | да | План продаж. |
| `created_by` | `uuid` | да | Кто создал план. |

Связи:

- `store_sales_plans.store_id -> stores.id`.

Ограничения:

- На один магазин и период должен быть один активный план.
- Выполнение плана считается по обороту магазина.

### `employees`

Сотрудники компании.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `full_name` | `text` | да | Имя сотрудника. |
| `phone` | `text` | нет | Телефон. |
| `telegram_user_id` | `bigint` | нет | Telegram user id. |
| `telegram_username` | `text` | нет | Telegram username. |
| `email` | `text` | нет | Email. |
| `city` | `text` | нет | Город. |
| `primary_store_id` | `uuid` | нет | Основной магазин. |
| `employee_status` | `text` | да | `padawan` или `experienced`. |
| `hired_at` | `date` | да | Дата приема. |
| `terminated_at` | `date` | нет | Дата увольнения. |
| `is_active` | `boolean` | да | Работает ли сотрудник. |

Связи:

- `employees.primary_store_id -> stores.id`.

Правила:

- Статус `padawan` / `experienced` меняется вручную управляющим или супер-админом.
- Роль и статус сотрудника независимы.
- Увольнение не удаляет сотрудника и историю.

### `employee_store_assignments`

Периоды привязки сотрудника к магазинам.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `store_id` | `uuid` | да | Магазин. |
| `valid_from` | `date` | да | Начало периода. |
| `valid_to` | `date` | нет | Конец периода. |
| `is_primary` | `boolean` | да | Основной магазин в периоде. |

Назначение:

- История регулярной работы сотрудника по магазинам.
- Фактический магазин смены все равно хранится в `shifts.store_id`.

## Schedules and shifts

### `schedules`

Плановые смены графика.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `employee_id` | `uuid` | да | Запланированный сотрудник. |
| `shift_date` | `date` | да | Дата смены. |
| `planned_start_at` | `timestamptz` | да | Плановое начало. |
| `planned_end_at` | `timestamptz` | да | Плановое окончание. |
| `status` | `text` | да | Активна, отменена, отпуск, больничный и т.д. |
| `created_by` | `uuid` | да | Управляющий или супер-админ. |

Правила:

- График создают управляющий и супер-админ.
- Менеджер может открыть смену без графика.

### `shifts`

Фактические смены.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `schedule_id` | `uuid` | нет | Плановая смена, если была. |
| `store_id` | `uuid` | да | Фактический магазин смены. |
| `shift_date` | `date` | да | Рабочий день магазина. |
| `status` | `text` | да | Статус смены. |
| `source` | `text` | да | `schedule` или `manual_open`. |
| `opened_by_employee_id` | `uuid` | да | Основной продавец, открывший смену. |
| `opened_at` | `timestamptz` | да | Время открытия. |
| `closed_by_employee_id` | `uuid` | нет | Кто закрыл. |
| `closed_at` | `timestamptz` | нет | Время закрытия. |
| `auto_closed_at` | `timestamptz` | нет | Время автозакрытия. |
| `requires_review` | `boolean` | да | Требует проверки. |
| `review_reason` | `text` | нет | Причина проверки. |

Ограничения:

- Ночных смен нет, смена относится к одному `shift_date`.
- Автозакрытая смена получает `requires_review = true`.
- Закрытую смену исправляет только супер-админ через `shift_corrections`.

### `shift_participants`

Участники смены.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `participant_role` | `text` | да | `primary_seller` или `secondary_seller`. |
| `sales_percent` | `numeric(6,4)` | да | 0.02 или 0.01. |

Ограничения:

- В смене один основной продавец.
- Второй продавец не открывает и не закрывает смену.
- Оборот смены учитывается обоим продавцам с разными процентами.

### `shift_closing_reports`

Кассовый отчет закрытия смены.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `cash_revenue` | `numeric(12,2)` | да | Выручка наличными. |
| `card_revenue` | `numeric(12,2)` | да | Выручка безналом. |
| `cash_returns` | `numeric(12,2)` | да | Возвраты наличными. |
| `card_returns` | `numeric(12,2)` | да | Возвраты безналом. |
| `receipt_count` | `integer` | да | Количество чеков. |
| `items_sold_count` | `integer` | нет | Количество проданных товаров. |
| `gross_revenue` | `numeric(12,2)` | да | Оборот без вычитания возвратов. |
| `net_revenue` | `numeric(12,2)` | да | Фактический итог с учетом возвратов, если нужен для кассы. |
| `cash_collection_amount` | `numeric(12,2)` | нет | Инкассация / выемка. |
| `cash_collection_comment` | `text` | нет | Причина выемки / РКО. |
| `check_depth` | `numeric(10,2)` | нет | Глубина чека. |
| `advance_amount` | `numeric(12,2)` | нет | Аванс закрывающего смену. |
| `created_by_employee_id` | `uuid` | да | Основной продавец. |

Правила:

- `gross_revenue = cash_revenue + card_revenue`.
- Возвраты не уменьшают оборот сотрудника для зарплаты.
- `check_depth = items_sold_count / receipt_count`, если `receipt_count > 0`.
- При выемке нужен текстовый комментарий.

### `cash_denominations`

Справочник номиналов для покупюрника.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `value` | `numeric(10,2)` | да | Номинал. |
| `kind` | `text` | да | Купюра, монета, мешок. |
| `is_active` | `boolean` | да | Используется ли сейчас. |

### `shift_cash_counts`

Покупюрник закрытия смены.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_closing_report_id` | `uuid` | да | Кассовый отчет. |
| `denomination_id` | `uuid` | да | Номинал. |
| `quantity` | `integer` | да | Количество. |
| `line_amount` | `numeric(12,2)` | да | `value * quantity`. |

Ограничения:

- Сотрудник вводит количество.
- Суммы считаются системой.

### `cash_report_files`

Фото кассового отчета ККМ.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `file_id` | `uuid` | да | Файл из `files`. |
| `uploaded_by` | `uuid` | да | Кто загрузил. |

### `shift_snapshots`

Неизменяемый снимок закрытой смены.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `snapshot_version` | `integer` | да | Версия структуры. |
| `data` | `jsonb` | да | Все данные, нужные для payroll и аналитики. |
| `data_quality` | `text` | да | `complete`, `auto_closed_requires_review`, `corrected`. |
| `created_at` | `timestamptz` | да | Когда сформирован. |

Ограничения:

- Snapshot не редактируется.
- Корректировки создают новую запись корректировки, а не переписывают snapshot.

### `shift_corrections`

Корректировки закрытых смен.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `correction_type` | `text` | да | Тип корректировки. |
| `reason` | `text` | да | Причина. |
| `before_data` | `jsonb` | да | Данные до. |
| `after_data` | `jsonb` | да | Данные после. |
| `created_by` | `uuid` | да | Только супер-админ. |

## Checklists and audits

### `checklist_templates`

Шаблоны чек-листов.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `name` | `text` | да | Название. |
| `version` | `integer` | да | Версия. |
| `is_active` | `boolean` | да | Активен ли шаблон. |
| `effective_from` | `date` | да | Начало действия. |

### `checklist_items`

Пункты чек-листа.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `template_id` | `uuid` | да | Шаблон. |
| `title` | `text` | да | Название пункта. |
| `sort_order` | `integer` | да | Порядок. |
| `is_active` | `boolean` | да | Активен ли пункт. |

### `checklist_item_weights`

Веса пунктов для статусов сотрудников.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `item_id` | `uuid` | да | Пункт чек-листа. |
| `employee_status` | `text` | да | `padawan` или `experienced`. |
| `weight_amount` | `numeric(12,2)` | да | Вес в рублях. |

Ограничения:

- Один вес на пункт и статус в рамках версии шаблона.

### `checklist_submissions`

Проведенный чек-лист сотрудника.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `template_id` | `uuid` | да | Версия шаблона. |
| `store_id` | `uuid` | да | Магазин. |
| `employee_id` | `uuid` | да | Проверяемый сотрудник. |
| `auditor_employee_id` | `uuid` | да | Проверяющий. |
| `submitted_at` | `timestamptz` | да | Когда проведен. |
| `period_month` | `date` | да | Месяц расчета. |
| `employee_status_snapshot` | `text` | да | Статус сотрудника на момент проверки. |
| `average_score` | `numeric(4,2)` | да | Средняя оценка. |
| `salary_per_shift_amount` | `numeric(12,2)` | да | Сумма чек-листа для оклада за смену. |
| `comment` | `text` | нет | Комментарий. |

Правила:

- Оценка каждого пункта от 1 до 10.
- Результат пункта = вес / 10 * оценка.
- Сумма пунктов = окладная часть за смену по этому чек-листу.

### `checklist_submission_items`

Оценки по пунктам чек-листа.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `submission_id` | `uuid` | да | Проведенный чек-лист. |
| `item_id` | `uuid` | да | Пункт. |
| `score` | `integer` | да | Оценка 1-10. |
| `weight_amount_snapshot` | `numeric(12,2)` | да | Вес на момент проверки. |
| `result_amount` | `numeric(12,2)` | да | Вес / 10 * оценка. |
| `comment` | `text` | нет | Комментарий. |

### `store_checklist_score_summaries`

Рассчитанные средние оценки магазина.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `period_month` | `date` | да | Месяц. |
| `average_score` | `numeric(4,2)` | да | Средняя оценка. |
| `submission_count` | `integer` | да | Количество чек-листов. |

## Payroll inputs

### `employee_advances`

Авансы сотрудников.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `shift_id` | `uuid` | нет | Смена, если аванс взят при закрытии. |
| `period_month` | `date` | да | Расчетный месяц. |
| `amount` | `numeric(12,2)` | да | Сумма. |
| `source` | `text` | да | `shift_closing`, `manual_adjustment`, `import`. |

### `expiration_writeoffs`

Просрочка магазина.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `period_month` | `date` | да | Месяц. |
| `amount` | `numeric(12,2)` | да | Сумма просрочки. |
| `source` | `text` | да | `manual` или `warehouse_google_sheet_import`. |
| `created_by` | `uuid` | да | Управляющий или супер-админ. |

Правило распределения:

- Поровну между основными менеджерами магазина.

### `payroll_product_writeoffs`

Товары под зарплату.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `period_month` | `date` | да | Месяц. |
| `amount` | `numeric(12,2)` | да | Сумма по закупочной цене. |
| `approved_by` | `uuid` | да | Управляющий или супер-админ. |
| `source` | `text` | да | `manual` или `warehouse_google_sheet_import`. |
| `comment` | `text` | нет | Комментарий. |

### `inventory_periods`

Периоды инвентаризации.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `period_start` | `date` | да | Начало периода. |
| `period_end` | `date` | да | Конец периода. |
| `turnover_amount` | `numeric(12,2)` | да | Оборот за период. |
| `loss_amount` | `numeric(12,2)` | да | Потери. |
| `company_compensation_amount` | `numeric(12,2)` | да | Оборот * 0.003. |
| `amount_after_compensation` | `numeric(12,2)` | да | Потери - компенсация. |
| `distributable_amount` | `numeric(12,2)` | да | Сумма после компенсации / 4. |
| `created_by` | `uuid` | да | Управляющий или супер-админ. |

Ограничения:

- Если сумма после компенсации меньше или равна нулю, удержания не создаются.

### `inventory_loss_allocations`

Распределение инвентаризационных удержаний.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `inventory_period_id` | `uuid` | да | Инвентаризация. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `worked_days` | `numeric(8,2)` | да | Дни или смены работы. |
| `total_worked_days` | `numeric(8,2)` | да | Общее количество дней всех сотрудников. |
| `share_ratio` | `numeric(10,6)` | да | Доля сотрудника. |
| `amount` | `numeric(12,2)` | да | Удержание. |

## Tasks

### `tasks`

Задачи.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `assignee_employee_id` | `uuid` | да | Исполнитель. |
| `created_by` | `uuid` | да | Управляющий или супер-админ. |
| `title` | `text` | да | Название. |
| `description` | `text` | нет | Описание. |
| `due_at` | `timestamptz` | нет | Дедлайн. |
| `priority` | `text` | да | Приоритет. |
| `status` | `text` | да | Статус. |
| `recurrence_rule_id` | `uuid` | нет | Правило повторения. |
| `completed_at` | `timestamptz` | нет | Когда закрыта. |
| `completed_by` | `uuid` | нет | Кто закрыл. |

### `task_recurrence_rules`

Правила повторения задач.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `store_id` | `uuid` | да | Магазин. |
| `assignee_employee_id` | `uuid` | да | Исполнитель. |
| `title` | `text` | да | Название будущих задач. |
| `description` | `text` | нет | Описание. |
| `frequency` | `text` | да | День, неделя, месяц и т.д. |
| `is_active` | `boolean` | да | Активно ли правило. |
| `next_run_at` | `timestamptz` | да | Следующий запуск. |

Правило:

- Новая задача создается даже при невыполненной предыдущей.
- Управляющий получает уведомление о невыполненной предыдущей.

### `task_comments`

Комментарии к задачам.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `task_id` | `uuid` | да | Задача. |
| `author_profile_id` | `uuid` | да | Автор. |
| `body` | `text` | да | Текст. |

### `task_files`

Файлы и фотоотчеты задач.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `task_id` | `uuid` | да | Задача. |
| `file_id` | `uuid` | да | Файл. |
| `file_kind` | `text` | да | `attachment`, `photo_report`. |

## KPI and payroll outputs

### `kpi_periods`

Периоды KPI.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `period_start` | `date` | да | Начало. |
| `period_end` | `date` | да | Конец. |
| `status` | `text` | да | `open`, `calculated`, `closed`. |

### `sales_metrics`

Показатели продаж продавцов.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `shift_id` | `uuid` | да | Смена. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `store_id` | `uuid` | да | Магазин. |
| `period_month` | `date` | да | Месяц. |
| `gross_revenue` | `numeric(12,2)` | да | Оборот без вычитания возвратов. |
| `receipt_count` | `integer` | да | Количество чеков. |
| `items_sold_count` | `integer` | нет | Количество товаров. |
| `average_check_amount` | `numeric(12,2)` | нет | Оборот / чеки. |
| `check_depth` | `numeric(10,2)` | нет | Товары / чеки. |
| `sales_percent` | `numeric(6,4)` | да | Процент payroll: 0.02 или 0.01. |
| `sales_pay_amount` | `numeric(12,2)` | да | Продажная часть payroll. |

### `payroll_periods`

Периоды зарплаты.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `period_month` | `date` | да | Месяц. |
| `status` | `text` | да | `open`, `calculated`, `closed`. |
| `calculated_at` | `timestamptz` | нет | Когда рассчитан. |
| `closed_at` | `timestamptz` | нет | Когда закрыт. |

### `payroll_entries`

Расчет зарплаты сотрудника за месяц.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `payroll_period_id` | `uuid` | да | Период. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `shift_count` | `numeric(8,2)` | да | Количество смен. |
| `gross_revenue` | `numeric(12,2)` | да | Оборот для зарплаты. |
| `sales_pay_amount` | `numeric(12,2)` | да | 2% или 1% от оборота. |
| `plan_bonus_amount` | `numeric(12,2)` | да | Надбавка 1% за план. |
| `checklist_salary_per_shift` | `numeric(12,2)` | да | Средний результат чек-листов. |
| `base_salary_amount` | `numeric(12,2)` | да | Смены * окладная часть. |
| `manual_bonus_amount` | `numeric(12,2)` | да | Премии. |
| `advance_amount` | `numeric(12,2)` | да | Авансы. |
| `expiration_writeoff_amount` | `numeric(12,2)` | да | Просрочка. |
| `inventory_loss_amount` | `numeric(12,2)` | да | Инвентаризация. |
| `product_writeoff_amount` | `numeric(12,2)` | да | Под ЗП. |
| `total_payout_amount` | `numeric(12,2)` | да | На руки. |
| `calculation_snapshot` | `jsonb` | да | Расшифровка расчета. |

Формула:

```text
Итого = продажная часть + надбавка за план + оклад + премия - аванс - просрочка - инвента - под ЗП
```

### `payroll_adjustments`

Ручные премии, бонусы, штрафы и корректировки.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `period_month` | `date` | да | Месяц. |
| `adjustment_type` | `text` | да | `manual_bonus`, `bonus`, `fine`, `correction`. |
| `amount` | `numeric(12,2)` | да | Сумма. |
| `reason` | `text` | да | Причина. |
| `created_by` | `uuid` | да | Управляющий или супер-админ. |

Ограничение:

- Ручную премию создает управляющий или супер-админ.

### `payroll_snapshots`

Зафиксированные результаты payroll.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `payroll_period_id` | `uuid` | да | Период. |
| `employee_id` | `uuid` | да | Сотрудник. |
| `data` | `jsonb` | да | Полная расшифровка. |
| `created_at` | `timestamptz` | да | Когда зафиксирован. |

## Integrations, files, notifications

### `warehouse_google_sheet_imports`

Импорт данных кладовщика.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `source_sheet_id` | `text` | да | Google Sheet id. |
| `import_type` | `text` | да | `expiration_writeoffs`, `payroll_product_writeoffs`. |
| `period_month` | `date` | нет | Месяц. |
| `status` | `text` | да | Статус импорта. |
| `rows_imported` | `integer` | да | Количество строк. |
| `error_message` | `text` | нет | Ошибка. |
| `started_at` | `timestamptz` | да | Начало. |
| `finished_at` | `timestamptz` | нет | Конец. |

### `files`

Метаданные файлов Supabase Storage.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `bucket` | `text` | да | Bucket. |
| `path` | `text` | да | Путь. |
| `mime_type` | `text` | нет | MIME. |
| `size_bytes` | `bigint` | нет | Размер. |
| `uploaded_by` | `uuid` | да | Кто загрузил. |
| `related_entity_type` | `text` | нет | Тип сущности. |
| `related_entity_id` | `uuid` | нет | ID сущности. |

### `notifications`

Внутренние уведомления.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `recipient_profile_id` | `uuid` | да | Получатель. |
| `event_type` | `text` | да | Тип события. |
| `title` | `text` | да | Заголовок. |
| `body` | `text` | да | Текст. |
| `related_entity_type` | `text` | нет | Тип связанной сущности. |
| `related_entity_id` | `uuid` | нет | ID связанной сущности. |
| `is_read` | `boolean` | да | Прочитано. |
| `created_at` | `timestamptz` | да | Когда создано. |

### `notification_deliveries`

Попытки доставки уведомлений.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `notification_id` | `uuid` | да | Уведомление. |
| `channel` | `text` | да | `telegram`, `email`. |
| `status` | `text` | да | `pending`, `sent`, `failed`. |
| `sent_at` | `timestamptz` | нет | Когда отправлено. |
| `error_message` | `text` | нет | Ошибка. |

### `audit_log`

Журнал критичных изменений.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `actor_profile_id` | `uuid` | нет | Кто выполнил. |
| `action` | `text` | да | Действие. |
| `entity_type` | `text` | да | Тип сущности. |
| `entity_id` | `uuid` | нет | ID сущности. |
| `before_data` | `jsonb` | нет | До. |
| `after_data` | `jsonb` | нет | После. |
| `reason` | `text` | нет | Причина. |
| `created_at` | `timestamptz` | да | Когда. |

### `cron_job_runs`

Журнал автоматических задач.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `job_name` | `text` | да | Название задачи. |
| `status` | `text` | да | `success`, `failed`, `partial`. |
| `started_at` | `timestamptz` | да | Начало. |
| `finished_at` | `timestamptz` | нет | Конец. |
| `details` | `jsonb` | нет | Детали. |
| `error_message` | `text` | нет | Ошибка. |

### `daily_digest_runs`

Ежедневные сводки.

| Поле | Тип | Обяз. | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | да | Primary key. |
| `recipient_profile_id` | `uuid` | да | Получатель. |
| `digest_date` | `date` | да | Дата сводки. |
| `summary_data` | `jsonb` | да | Содержимое сводки. |
| `notification_id` | `uuid` | нет | Уведомление. |

## RLS-модель MVP

### Manager

- Читает свои смены, задачи, уведомления, KPI и зарплату.
- Создает и закрывает свои смены.
- Загружает фото ККМ по своей смене.
- Выполняет и комментирует свои задачи.

### Auditor

- Читает магазины в своей области.
- Создает чек-листы и проверки.
- Читает историю своих проверок и проверки в разрешенной области.

### Store manager

- Управляет сотрудниками с ролью менеджера в своей области.
- Управляет графиком, задачами, чек-листами, просрочкой, товарами под ЗП и инвентаризацией в своей области.
- Читает payroll сотрудников в своей области.
- Не назначает роли выше менеджера.

### Super admin

- Полный доступ.
- Исправляет закрытые смены.
- Назначает любые роли.
- Управляет payroll-правилами и критичными корректировками.

### Developer

- Доступ только через отдельно контролируемые технические процедуры.
- Все действия разработчика логируются в `developer_access_log` и `audit_log`.

## Следующий шаг

1. Согласовать спорные места в этой ERD.
2. Разделить таблицы на миграции Supabase.
3. Подготовить SQL enum-типы, таблицы, индексы и RLS skeleton.
4. После этого создать Next.js + Supabase проект.
