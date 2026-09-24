-- APP-053: explicit family mapping and fail-closed publication/licence metadata.
ALTER TABLE public.products
  ADD COLUMN ingredient_family_id text;

ALTER TABLE public.global_offers
  ADD COLUMN published boolean NOT NULL DEFAULT false,
  ADD COLUMN licence_cleared boolean NOT NULL DEFAULT false,
  ADD COLUMN member_condition text,
  ADD CONSTRAINT global_offers_member_condition_nonblank
    CHECK (member_condition IS NULL OR btrim(member_condition) <> '');

-- Eligibility is enforced at the database boundary so clients written before
-- APP-053 cannot read draft or uncleared rows through the legacy column shape.
DROP POLICY IF EXISTS "Authenticated users can view global offers" ON public.global_offers;
CREATE POLICY "Authenticated users can view eligible global offers"
  ON public.global_offers
  FOR SELECT
  TO authenticated
  USING (published = true AND licence_cleared = true);

-- Content admins need the complete catalogue for curation. This is a separate
-- permissive policy; support does not satisfy the existing role contract.
CREATE POLICY "Content admins can view all global offers"
  ON public.global_offers
  FOR SELECT
  TO authenticated
  USING (public.admin_has_role(array['owner','editor']::text[]));

-- Existing owner/editor INSERT/UPDATE/DELETE policies remain unchanged.
-- Historical rows retain both false defaults until admin curation.
