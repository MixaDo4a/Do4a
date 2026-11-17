alter table public.task_completion_photos
  alter column expires_at set default (now() + interval '7 days');
