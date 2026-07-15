# System Architecture

## Назначение

Документ описывает общую архитектуру приложения.

## Основной подход

Система строится как web-приложение с frontend на Next.js и backend на Supabase.

Основные компоненты:

- Next.js application.
- Telegram Mini App wrapper.
- Supabase Auth.
- PostgreSQL database.
- Supabase Row Level Security.
- Supabase Edge Functions.
- Supabase Storage.
- Cron jobs.
- External integrations: Telegram Bot API, СБИС OFD, Google Sheets export.

## Архитектурные ограничения

- Клиент не выполняет доверенные расчеты.
- Финансовые и кадровые операции проходят серверную проверку.
- Исторические данные защищаются snapshots и audit log.
- Интеграции не являются источником истины, кроме импортируемых фактов с сохранением в PostgreSQL.

## Требует уточнения

- Финальная схема авторизации Telegram Mini App.
- Подход к ролям в Supabase Auth metadata и собственных таблицах.
- Способ запуска cron-задач.
- Детали интеграции с СБИС OFD.
