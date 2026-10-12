update public.checklist_submission_items submission_item
set title_snapshot = coalesce(
  (
    select nullif(setting.custom_title, '')
    from public.store_checklist_item_settings setting
    join public.checklist_submissions submission on submission.store_id = setting.store_id
    where submission.id = submission_item.submission_id
      and setting.item_id = submission_item.item_id
  ),
  (select item.title from public.checklist_items item where item.id = submission_item.item_id)
)
where submission_item.title_snapshot is null;
