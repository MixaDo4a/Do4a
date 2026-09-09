alter table public.payroll_adjustments
  drop constraint if exists payroll_adjustments_type_check;

alter table public.payroll_adjustments
  add constraint payroll_adjustments_type_check check (
    adjustment_type in ('bonus', 'fine', 'advance', 'inventory', 'expiration', 'product')
  );
