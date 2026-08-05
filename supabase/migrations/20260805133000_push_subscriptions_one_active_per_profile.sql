with ranked as (
  select
    id,
    row_number() over (partition by profile_id order by created_at desc, id desc) as rn
  from public.push_subscriptions
  where is_active = true
)
update public.push_subscriptions ps
set is_active = false
from ranked r
where ps.id = r.id
  and r.rn > 1;

create unique index if not exists push_subscriptions_one_active_per_profile_idx
  on public.push_subscriptions (profile_id)
  where is_active;
