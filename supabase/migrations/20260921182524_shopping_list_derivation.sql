-- APP-052: additive Food shopping artifacts and separate durable provenance.
ALTER TABLE public.food_shopping_items
  ADD COLUMN source_kind text NOT NULL DEFAULT 'manual',
  ADD CONSTRAINT food_shopping_source_kind_check CHECK (source_kind IN ('manual', 'meal_plan'));

-- Old PostgREST upserts omit source_kind. Their INSERT default becomes the
-- EXCLUDED value on conflict; this trigger prevents a derived row's downgrade.
CREATE FUNCTION public.preserve_food_shopping_source_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.source_kind = 'meal_plan' AND NEW.source_kind = 'manual' THEN
    NEW.source_kind := 'meal_plan';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_food_shopping_source_kind_before_update
  BEFORE UPDATE ON public.food_shopping_items FOR EACH ROW
  EXECUTE FUNCTION public.preserve_food_shopping_source_kind();

DROP POLICY IF EXISTS "update own" ON public.food_shopping_items;
CREATE POLICY "update own" ON public.food_shopping_items FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE TABLE public.food_shopping_item_derivations (
  user_id uuid NOT NULL,
  shopping_item_id text NOT NULL,
  week_key text NOT NULL CHECK (week_key ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  identity_kind text NOT NULL CHECK (identity_kind IN ('family', 'unlinked', 'legacy')),
  family_id text,
  source_recipe_id text,
  source_ingredient_index integer,
  identity_unit text,
  amount_kind text NOT NULL CHECK (amount_kind IN ('structured', 'legacy')),
  current_quantity numeric,
  current_unit text,
  current_legacy_text text,
  repetitions integer,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'array' AND jsonb_array_length(provenance) > 0),
  CONSTRAINT food_shopping_derivation_pkey PRIMARY KEY (user_id, shopping_item_id),
  CONSTRAINT food_shopping_derivation_item_fkey FOREIGN KEY (user_id, shopping_item_id)
    REFERENCES public.food_shopping_items(user_id, id) ON DELETE CASCADE,
  CONSTRAINT food_shopping_derivation_identity_check CHECK (
    (identity_kind = 'family' AND family_id IS NOT NULL AND source_recipe_id IS NULL AND source_ingredient_index IS NULL AND identity_unit IS NOT NULL AND identity_unit IN ('g', 'ml', 'piece')) OR
    (identity_kind = 'unlinked' AND family_id IS NULL AND source_recipe_id IS NOT NULL AND source_ingredient_index IS NOT NULL AND source_ingredient_index >= 0 AND identity_unit IS NOT NULL AND identity_unit IN ('g', 'ml', 'piece')) OR
    (identity_kind = 'legacy' AND family_id IS NULL AND source_recipe_id IS NOT NULL AND source_ingredient_index IS NOT NULL AND source_ingredient_index >= 0 AND identity_unit IS NULL)
  ),
  CONSTRAINT food_shopping_derivation_amount_check CHECK (
    (amount_kind = 'structured' AND identity_kind <> 'legacy' AND current_quantity IS NOT NULL AND current_quantity > 0 AND current_quantity < 'Infinity'::numeric
      AND current_unit IS NOT NULL AND current_unit IN ('g', 'ml', 'piece') AND current_legacy_text IS NULL AND repetitions IS NULL) OR
    (amount_kind = 'legacy' AND identity_kind = 'legacy' AND current_quantity IS NULL AND current_unit IS NULL
      AND current_legacy_text IS NOT NULL AND repetitions IS NOT NULL AND repetitions > 0)
  )
);
ALTER TABLE public.food_shopping_item_derivations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select own" ON public.food_shopping_item_derivations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE POLICY "insert own" ON public.food_shopping_item_derivations FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "update own" ON public.food_shopping_item_derivations FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "delete own" ON public.food_shopping_item_derivations FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_shopping_item_derivations TO authenticated;
