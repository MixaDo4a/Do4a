update public.notifications
set title = 'График изменён',
    body = 'Изменено смен: ' ||
      coalesce(substring(body from '([0-9]+)'), '0') ||
      '. Проверьте график.'
where event_type = 'schedule_changed';
