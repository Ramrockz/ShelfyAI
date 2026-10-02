-- Log every cost-per-unit change of an item into ingredient_history, so
-- "Shelfy's take" on the item page can show how the cost developed.
-- cost_per_unit is written from many places (expenses, item edit, CSV
-- import, operations, products), so a trigger catches them all at once.
-- Safe to run more than once.

create or replace function public.log_ingredient_cost_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ingredient_history
    (ingredient_id, profile_id, field_name, old_value, new_value, reason, store_id, changed_at)
  values
    (new.id, new.profile_id, 'cost_per_unit', old.cost_per_unit::text, new.cost_per_unit::text, 'cost_change', new.store_id, now());
  return new;
end;
$$;

drop trigger if exists trg_log_ingredient_cost_change on public.ingredients;
create trigger trg_log_ingredient_cost_change
  after update of cost_per_unit on public.ingredients
  for each row
  when (old.cost_per_unit is distinct from new.cost_per_unit)
  execute function public.log_ingredient_cost_change();
