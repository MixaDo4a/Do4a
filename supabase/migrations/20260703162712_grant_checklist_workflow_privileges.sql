grant select on table
  public.checklist_templates,
  public.checklist_items,
  public.checklist_item_weights,
  public.checklist_submissions,
  public.checklist_submission_items
to authenticated;

grant insert on table
  public.checklist_submissions,
  public.checklist_submission_items
to authenticated;
