-- APP-062 / ADR-0050. Additive Moving template provenance on household_moving_items.
-- Local file only: remote deployment requires a separate reviewed operation.
--
-- The three columns record which bundled template version a row was copied from. They are
-- all NULL for user-created rows and for historical rows (a client derives provenance for
-- the five legacy default-* ids from the fixed id, so nothing is backfilled here).
-- No template table, no RPC and no CMS: the catalogue is bundled app content.
begin;

alter table public.household_moving_items
  add column if not exists template_id text,
  add column if not exists template_version integer,
  add column if not exists template_item_id text;

comment on column public.household_moving_items.template_id is
  'Stable bundled template id the row was copied from. NULL together with its two siblings for user-created rows.';

-- All three provenance fields are NULL, or all three are present and well formed. The
-- identifier pattern matches core/home/moving.ts (kebab-case template ids, camelCase item keys).
alter table public.household_moving_items
  drop constraint if exists household_moving_items_template_provenance_check;
alter table public.household_moving_items
  add constraint household_moving_items_template_provenance_check check (
    (template_id is null and template_version is null and template_item_id is null)
    or (
      -- Explicit IS NOT NULL: a CHECK also passes on NULL, and `NULL AND true` is NULL.
      template_id is not null and template_id ~ '^[a-z][A-Za-z0-9-]{0,63}$'
      and template_version is not null and template_version > 0
      and template_item_id is not null and template_item_id ~ '^[a-z][A-Za-z0-9-]{0,63}$'
    )
  );

commit;
