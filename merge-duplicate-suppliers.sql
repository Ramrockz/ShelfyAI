-- One-time cleanup: merges supplier rows that are duplicates of the same
-- vendor (same profile + store, same name) created before
-- materializeDefaultSupplier() (ingredient-detail.html) started reusing an
-- existing supplier by name instead of always inserting a new one.
--
-- Without this, ingredients that were already materialized before that fix
-- stay pointed at their own separate supplier row and never show up in
-- each other's "Ship together" list, even though they're the same real
-- vendor. Safe to run once: ingredient_suppliers rows are re-pointed to
-- the oldest ("keeper") row for each vendor BEFORE the duplicate supplier
-- rows are deleted, so nothing is orphaned.

WITH ranked AS (
  SELECT id, profile_id, store_id, name,
         ROW_NUMBER() OVER (
           PARTITION BY profile_id, store_id, lower(name)
           ORDER BY created_at
         ) AS rn
  FROM suppliers
),
keepers AS (
  SELECT profile_id, store_id, lower(name) AS lname, id AS keep_id
  FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id AS dupe_id, k.keep_id
  FROM ranked r
  JOIN keepers k
    ON k.profile_id = r.profile_id
   AND k.lname = lower(r.name)
   AND k.store_id IS NOT DISTINCT FROM r.store_id
  WHERE r.rn > 1
)
UPDATE ingredient_suppliers isup
SET supplier_id = d.keep_id
FROM dupes d
WHERE isup.supplier_id = d.dupe_id;

WITH ranked AS (
  SELECT id, profile_id, store_id, name,
         ROW_NUMBER() OVER (
           PARTITION BY profile_id, store_id, lower(name)
           ORDER BY created_at
         ) AS rn
  FROM suppliers
)
DELETE FROM suppliers s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;
