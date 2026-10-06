-- APP-060 review fix: one durable marker per Trip and exact template release.
--
-- The marker is separate from trip_packing_items: copied rows stay ordinary editable
-- user data, while deleting or renaming every copied row cannot make the source template
-- look unapplied. Clients never infer this relation from labels.

CREATE TABLE public.trip_packing_template_applications (
  trip_id text NOT NULL,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_packing_template_applications_pkey
    PRIMARY KEY (trip_id, template_id, template_version),
  CONSTRAINT trip_packing_template_applications_trip_fkey
    FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
  CONSTRAINT trip_packing_template_applications_id_check
    CHECK (btrim(template_id) <> '' AND char_length(template_id) <= 100),
  CONSTRAINT trip_packing_template_applications_version_check
    CHECK (template_version > 0)
);

CREATE INDEX trip_packing_template_applications_applied_by_idx
  ON public.trip_packing_template_applications(applied_by)
  WHERE applied_by IS NOT NULL;

COMMENT ON TABLE public.trip_packing_template_applications IS
  'APP-060 Trip-scoped record that an exact bundled packing template version was explicitly applied. Copied rows remain ordinary trip_packing_items.';

ALTER TABLE public.trip_packing_template_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_packing_template_applications FROM PUBLIC, anon, authenticated;

-- Read only the markers for one Trip the caller currently owns or participates in.
-- Pending, declined, removed and unrelated accounts all receive no rows.
CREATE FUNCTION public.list_trip_packing_template_applications(p_trip_id text)
RETURNS TABLE (
  template_id text,
  template_version integer,
  applied_by uuid,
  applied_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.trips t
    WHERE t.id = p_trip_id
      AND (
        t.user_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.trip_participants p
          WHERE p.trip_id = t.id AND p.owner_id = t.user_id
            AND p.user_id = v_uid AND p.status = 'accepted'
        )
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.template_id, a.template_version, a.applied_by, a.applied_at
  FROM public.trip_packing_template_applications a
  WHERE a.trip_id = p_trip_id
  ORDER BY a.template_id, a.template_version;
END;
$$;

REVOKE ALL ON FUNCTION public.list_trip_packing_template_applications(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_trip_packing_template_applications(text) TO authenticated;

-- Atomically claims an exact template release and inserts its independent packing rows.
-- The Trip and accepted-membership locks serialize this with Trip deletion and access
-- removal; the primary key serializes two devices applying the same release. A losing
-- retry inserts no rows.
CREATE FUNCTION public.apply_trip_packing_template(
  p_trip_id text,
  p_expected_account_id uuid,
  p_template_id text,
  p_template_version integer,
  p_items jsonb
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer;
  v_owner_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_expected_account_id IS NULL OR p_expected_account_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_mismatch';
  END IF;
  IF p_template_id IS NULL OR btrim(p_template_id) = '' OR char_length(p_template_id) > 100 THEN
    RAISE EXCEPTION 'template_id_invalid';
  END IF;
  IF p_template_version IS NULL OR p_template_version <= 0 THEN
    RAISE EXCEPTION 'template_version_invalid';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'template_items_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE jsonb_typeof(item) <> 'object'
      OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
      OR btrim(item->>'id') = '' OR char_length(item->>'id') > 200
      OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
      OR btrim(item->>'label') = '' OR char_length(item->>'label') > 500
      OR jsonb_typeof(item->'category') IS DISTINCT FROM 'string'
      OR item->>'category' NOT IN ('essentials', 'clothing', 'electronics', 'toiletries', 'other')
  ) THEN
    RAISE EXCEPTION 'template_items_invalid';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items))
     <> (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_items) item) THEN
    RAISE EXCEPTION 'template_item_ids_duplicate';
  END IF;

  SELECT t.user_id INTO v_owner_id
  FROM public.trips t
  WHERE t.id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_access_denied'; END IF;
  IF v_owner_id <> v_uid THEN
    -- Hold the exact accepted-membership row through the insert. A concurrent removal
    -- waits and takes effect immediately after this already-authorized transaction.
    PERFORM 1
    FROM public.trip_participants p
    WHERE p.trip_id = p_trip_id AND p.owner_id = v_owner_id
      AND p.user_id = v_uid AND p.status = 'accepted'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'trip_access_denied'; END IF;
  END IF;

  INSERT INTO public.trip_packing_template_applications (
    trip_id, template_id, template_version, applied_by
  ) VALUES (
    p_trip_id, btrim(p_template_id), p_template_version, v_uid
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN 'already-applied'; END IF;

  INSERT INTO public.trip_packing_items (
    id, user_id, trip_id, label, checked, category
  )
  SELECT item->>'id', v_uid, p_trip_id, btrim(item->>'label'), false, item->>'category'
  FROM jsonb_array_elements(p_items) item;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_trip_packing_template(text, uuid, text, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_trip_packing_template(text, uuid, text, integer, jsonb)
  TO authenticated;
