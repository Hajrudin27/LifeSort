-- APP-050: retain historical free-text quantity without guessing its meaning.
ALTER TABLE public.food_pantry_items
  ADD COLUMN structured_quantity numeric,
  ADD COLUMN structured_unit text,
  ADD COLUMN purchased_date date,
  ADD COLUMN opened_date date;

ALTER TABLE public.food_pantry_items
  ADD CONSTRAINT food_pantry_structured_quantity_positive
    CHECK (structured_quantity IS NULL OR
      (structured_quantity > 0 AND structured_quantity < 'Infinity'::numeric)),
  ADD CONSTRAINT food_pantry_quantity_unit_pair
    CHECK ((structured_quantity IS NULL) = (structured_unit IS NULL)),
  ADD CONSTRAINT food_pantry_structured_unit_allowed
    CHECK (structured_unit IS NULL OR structured_unit IN ('g', 'ml', 'piece')),
  ADD CONSTRAINT food_pantry_legacy_or_structured
    CHECK (quantity IS NULL OR structured_quantity IS NULL);

-- The original pantry table had INSERT/SELECT/DELETE policies but no UPDATE.
-- Upsert on the existing (user_id, id) key requires an owner-scoped UPDATE.
CREATE POLICY "update own" ON public.food_pantry_items
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
