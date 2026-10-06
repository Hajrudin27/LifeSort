-- APP-059: Travel Budget Bridge.
--
-- public.expenses remains the one canonical financial record. Travel holds only
-- a relationship/category row and reads a deliberately narrow projection through
-- a SECURITY DEFINER function which rechecks trip access on every call.

-- New/edited budgets must be non-negative exact DKK cents inside APP-040's fully
-- supported range. NOT VALID preserves any unexplained historical value; it does
-- not weaken enforcement for new or changed rows.
ALTER TABLE public.trips
  ADD CONSTRAINT trips_budget_supported_money
  CHECK (
    budget IS NULL OR (
      budget >= 0
      AND budget = trunc(budget, 2)
      AND budget <= 8589934592.00
    )
  ) NOT VALID;

CREATE TABLE public.trip_expense_links (
  trip_id text NOT NULL,
  expense_owner_id uuid NOT NULL,
  expense_id text NOT NULL,
  travel_category text NOT NULL,
  legacy_trip_expense_id text,
  currency text,
  original_amount numeric,
  exchange_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_expense_links_pkey PRIMARY KEY (expense_owner_id, expense_id),
  CONSTRAINT trip_expense_links_trip_fkey
    FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
  CONSTRAINT trip_expense_links_expense_fkey
    FOREIGN KEY (expense_owner_id, expense_id)
    REFERENCES public.expenses(user_id, id) ON DELETE CASCADE,
  CONSTRAINT trip_expense_links_category_check CHECK (
    travel_category IN ('flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other')
  ),
  CONSTRAINT trip_expense_links_currency_check CHECK (
    currency IS NULL OR (btrim(currency) <> '' AND char_length(currency) <= 10)
  ),
  CONSTRAINT trip_expense_links_fx_coherent CHECK (
    (currency IS NULL AND original_amount IS NULL AND exchange_rate IS NULL)
    OR (currency IS NOT NULL AND original_amount IS NOT NULL AND exchange_rate IS NOT NULL)
  )
);

CREATE INDEX trip_expense_links_trip_idx ON public.trip_expense_links(trip_id);

COMMENT ON TABLE public.trip_expense_links IS
  'APP-059 relationship from one trip to the owner-scoped canonical Economy expense. Contains no canonical financial amount.';
COMMENT ON COLUMN public.trip_expense_links.legacy_trip_expense_id IS
  'Original Travel identity when a user explicitly resolves a pre-APP-059 expense date.';

ALTER TABLE public.trip_expense_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_expense_links FROM PUBLIC, anon, authenticated;

-- A caller gets no row at all unless they own the trip or are an accepted current
-- participant. Pending, declined, removed and unrelated accounts are identical.
CREATE FUNCTION public.trip_financial_projection(p_trip_id text)
RETURNS TABLE (
  trip_id text,
  expense_owner_id uuid,
  expense_id text,
  name text,
  amount numeric,
  travel_category text,
  transaction_date text,
  semantic text,
  status text,
  legacy_trip_expense_id text,
  currency text,
  original_amount numeric,
  exchange_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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
  SELECT l.trip_id, l.expense_owner_id, l.expense_id, e.name, e.amount,
         l.travel_category, e.next_payment_date::text,
         'expense'::text, 'booked'::text,
         l.legacy_trip_expense_id, l.currency, l.original_amount, l.exchange_rate
  FROM public.trip_expense_links l
  JOIN public.expenses e
    ON e.user_id = l.expense_owner_id AND e.id = l.expense_id
  WHERE l.trip_id = p_trip_id
  ORDER BY e.next_payment_date, l.created_at, l.expense_owner_id, l.expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_financial_projection(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_financial_projection(text) TO authenticated;

-- Creates Economy + link atomically. A legacy row is removed only after both
-- canonical rows exist, inside this same transaction. Missing server legacy data
-- is allowed because pre-APP-059 Travel records could be device-only.
CREATE FUNCTION public.link_trip_economy_expense(
  p_trip_id text,
  p_expected_account_id uuid,
  p_expense_id text,
  p_name text,
  p_amount numeric,
  p_travel_category text,
  p_transaction_date date,
  p_legacy_trip_expense_id text DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_original_amount numeric DEFAULT NULL,
  p_exchange_rate numeric DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.expenses%ROWTYPE;
  v_link public.trip_expense_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_expected_account_id IS NULL OR p_expected_account_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_mismatch';
  END IF;
  IF p_expense_id IS NULL OR btrim(p_expense_id) = '' THEN RAISE EXCEPTION 'expense_id_invalid'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR char_length(p_name) > 500 THEN RAISE EXCEPTION 'expense_name_invalid'; END IF;
  IF p_transaction_date IS NULL THEN RAISE EXCEPTION 'transaction_date_required'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount <> trunc(p_amount, 2) OR p_amount > 8589934592.00 THEN
    RAISE EXCEPTION 'money_unsupported_amount';
  END IF;
  IF p_travel_category IS NULL OR p_travel_category NOT IN
    ('flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other') THEN
    RAISE EXCEPTION 'travel_category_invalid';
  END IF;
  IF (p_currency IS NULL) <> (p_original_amount IS NULL)
     OR (p_currency IS NULL) <> (p_exchange_rate IS NULL) THEN
    RAISE EXCEPTION 'fx_metadata_invalid';
  END IF;
  IF p_legacy_trip_expense_id IS NOT NULL AND p_legacy_trip_expense_id <> p_expense_id THEN
    RAISE EXCEPTION 'legacy_identity_mismatch';
  END IF;

  -- The trip row lock serialises this with deletion and participant changes.
  PERFORM 1
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
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_access_denied'; END IF;

  -- An owner may read a participant-authored legacy row, but may never convert it
  -- into an owner-authored Economy expense. Unknown/device-only means no server row;
  -- when a server row exists, its original author must be the caller.
  IF p_legacy_trip_expense_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.trip_expenses e
       WHERE e.trip_id = p_trip_id AND e.id = p_legacy_trip_expense_id AND e.user_id <> v_uid
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.trip_expenses e
       WHERE e.trip_id = p_trip_id AND e.id = p_legacy_trip_expense_id AND e.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'legacy_author_mismatch';
  END IF;

  SELECT * INTO v_existing
  FROM public.expenses e
  WHERE e.user_id = v_uid AND e.id = p_expense_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.name <> btrim(p_name)
       OR v_existing.amount <> p_amount
       OR v_existing.category <> p_travel_category
       OR v_existing.next_payment_date <> p_transaction_date
       OR v_existing.is_recurring
       OR v_existing.recurrence_frequency IS NOT NULL
       OR v_existing.recurrence_anchor_day IS NOT NULL THEN
      RAISE EXCEPTION 'expense_identity_conflict';
    END IF;
  ELSE
    INSERT INTO public.expenses (
      id, user_id, series_id, is_recurring, recurrence_frequency,
      recurrence_anchor_day, name, amount, category, next_payment_date
    ) VALUES (
      p_expense_id, v_uid, p_expense_id, false, NULL,
      NULL, btrim(p_name), p_amount, p_travel_category, p_transaction_date
    );
  END IF;

  SELECT * INTO v_link
  FROM public.trip_expense_links l
  WHERE l.expense_owner_id = v_uid AND l.expense_id = p_expense_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_link.trip_id <> p_trip_id
       OR v_link.travel_category <> p_travel_category
       OR v_link.legacy_trip_expense_id IS DISTINCT FROM p_legacy_trip_expense_id
       OR v_link.currency IS DISTINCT FROM p_currency
       OR v_link.original_amount IS DISTINCT FROM p_original_amount
       OR v_link.exchange_rate IS DISTINCT FROM p_exchange_rate THEN
      RAISE EXCEPTION 'expense_link_conflict';
    END IF;
  ELSE
    INSERT INTO public.trip_expense_links (
      trip_id, expense_owner_id, expense_id, travel_category,
      legacy_trip_expense_id, currency, original_amount, exchange_rate
    ) VALUES (
      p_trip_id, v_uid, p_expense_id, p_travel_category,
      p_legacy_trip_expense_id, p_currency, p_original_amount, p_exchange_rate
    );
  END IF;

  IF p_legacy_trip_expense_id IS NOT NULL THEN
    DELETE FROM public.trip_expenses e
    WHERE e.user_id = v_uid AND e.id = p_legacy_trip_expense_id AND e.trip_id = p_trip_id;
  END IF;

  RETURN 'linked';
END;
$$;

REVOKE ALL ON FUNCTION public.link_trip_economy_expense(
  text, uuid, text, text, numeric, text, date, text, text, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_trip_economy_expense(
  text, uuid, text, text, numeric, text, date, text, text, numeric, numeric
) TO authenticated;

-- APP-058's public signatures stay stable. A linked Economy expense counts as a
-- trip dependency, but deleting the trip cascades only the link, never expenses.
CREATE OR REPLACE FUNCTION public.trip_deletion_preview(p_trip_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT t.user_id INTO v_owner FROM public.trips t WHERE t.id = p_trip_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('status', 'not-found'); END IF;
  IF v_owner <> v_uid THEN
    IF EXISTS (SELECT 1 FROM public.trip_participants p WHERE p.trip_id = p_trip_id
      AND p.owner_id = v_owner AND p.user_id = v_uid AND p.status = 'accepted') THEN
      RETURN jsonb_build_object('status', 'not-owner');
    END IF;
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  RETURN jsonb_build_object(
    'status', 'ok',
    'expenses', (SELECT count(*) FROM public.trip_expenses e WHERE e.trip_id = p_trip_id)
      + (SELECT count(*) FROM public.trip_expense_links l WHERE l.trip_id = p_trip_id),
    'packing_items', (SELECT count(*) FROM public.trip_packing_items i WHERE i.trip_id = p_trip_id),
    'participants', (SELECT count(*) FROM public.trip_participants p WHERE p.trip_id = p_trip_id AND p.owner_id = v_owner),
    'documents', (SELECT count(*) FROM public.trip_document_references r WHERE r.trip_id = p_trip_id AND r.user_id = v_owner)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_trip_if_dependencies_match(
  p_trip_id text, p_expenses integer, p_packing_items integer,
  p_participants integer, p_documents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_owner uuid;
  v_expenses bigint; v_packing bigint; v_participants bigint; v_documents bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT t.user_id INTO v_owner FROM public.trips t WHERE t.id = p_trip_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('status', 'not-found'); END IF;
  IF v_owner <> v_uid THEN
    IF EXISTS (SELECT 1 FROM public.trip_participants p WHERE p.trip_id = p_trip_id
      AND p.owner_id = v_owner AND p.user_id = v_uid AND p.status = 'accepted') THEN
      RETURN jsonb_build_object('status', 'not-owner');
    END IF;
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  PERFORM 1 FROM public.trips t WHERE t.id = p_trip_id AND t.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not-found'); END IF;

  SELECT (SELECT count(*) FROM public.trip_expenses e WHERE e.trip_id = p_trip_id)
       + (SELECT count(*) FROM public.trip_expense_links l WHERE l.trip_id = p_trip_id)
    INTO v_expenses;
  SELECT count(*) INTO v_packing FROM public.trip_packing_items i WHERE i.trip_id = p_trip_id;
  SELECT count(*) INTO v_participants FROM public.trip_participants p WHERE p.trip_id = p_trip_id AND p.owner_id = v_uid;
  SELECT count(*) INTO v_documents FROM public.trip_document_references r WHERE r.trip_id = p_trip_id AND r.user_id = v_uid;
  IF p_expenses IS DISTINCT FROM v_expenses::integer
     OR p_packing_items IS DISTINCT FROM v_packing::integer
     OR p_participants IS DISTINCT FROM v_participants::integer
     OR p_documents IS DISTINCT FROM v_documents::integer THEN
    RETURN jsonb_build_object(
      'status', 'changed', 'expenses', v_expenses, 'packing_items', v_packing,
      'participants', v_participants, 'documents', v_documents
    );
  END IF;
  DELETE FROM public.trips t WHERE t.id = p_trip_id AND t.user_id = v_uid;
  RETURN jsonb_build_object('status', 'deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.trip_deletion_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_deletion_preview(text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_trip_if_dependencies_match(text, integer, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip_if_dependencies_match(text, integer, integer, integer, integer)
  TO authenticated;
