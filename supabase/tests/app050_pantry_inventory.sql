-- APP-050 isolated PostgreSQL contract test. Run only in a fresh scratch cluster;
-- it creates a minimal pre-migration pantry table and an authenticated role.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE ROLE authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
CREATE TABLE public.food_pantry_items (
  id text NOT NULL, user_id uuid NOT NULL, name text NOT NULL, quantity text,
  expiry_date date, added_at timestamptz NOT NULL,
  CONSTRAINT food_pantry_items_pkey PRIMARY KEY (user_id, id)
);
ALTER TABLE public.food_pantry_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert own" ON public.food_pantry_items FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "select own" ON public.food_pantry_items FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
INSERT INTO public.food_pantry_items (id, user_id, name, quantity, expiry_date, added_at)
VALUES ('old', '11111111-1111-4111-8111-111111111111', 'Æg', 'ca. halvdelen', '2026-10-01', '2026-09-01T08:00:00Z');
\ir ../migrations/20260921114149_pantry_structured_inventory.sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.food_pantry_items
    WHERE id = 'old' AND quantity = 'ca. halvdelen' AND structured_quantity IS NULL
      AND structured_unit IS NULL AND purchased_date IS NULL AND opened_date IS NULL
      AND expiry_date = '2026-10-01' AND added_at = '2026-09-01T08:00:00Z'
  ) THEN RAISE EXCEPTION 'legacy row changed'; END IF;
END $$;
CREATE FUNCTION expect_check_reject(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'invalid Pantry row was accepted: %', statement;
EXCEPTION WHEN check_violation THEN NULL;
END $$;
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity) VALUES (''bad1'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),2)');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_unit) VALUES (''bad2'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),''g'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity,structured_unit) VALUES (''bad3'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),0,''g'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity,structured_unit) VALUES (''bad4'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),-1,''g'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity,structured_unit) VALUES (''bad5'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),''NaN''::numeric,''g'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity,structured_unit) VALUES (''bad6'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),''Infinity''::numeric,''g'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,structured_quantity,structured_unit) VALUES (''bad7'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),1,''kg'')');
SELECT expect_check_reject('INSERT INTO public.food_pantry_items (id,user_id,name,added_at,quantity,structured_quantity,structured_unit) VALUES (''bad8'',''11111111-1111-4111-8111-111111111111'',''Bad'',now(),''500 g'',500,''g'')');
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_pantry_items TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.food_pantry_items (id,user_id,name,structured_quantity,structured_unit,purchased_date,opened_date,added_at)
VALUES ('new','11111111-1111-4111-8111-111111111111','Milk',1.5,'ml','2026-09-01','2026-09-02','2026-09-01T08:00:00Z')
ON CONFLICT (user_id,id) DO UPDATE SET name = excluded.name;
INSERT INTO public.food_pantry_items (id,user_id,name,structured_quantity,structured_unit,added_at)
VALUES ('new','11111111-1111-4111-8111-111111111111','Milk edited',2,'piece','2026-09-01T08:00:00Z')
ON CONFLICT (user_id,id) DO UPDATE SET name = excluded.name, structured_quantity = excluded.structured_quantity,
  structured_unit = excluded.structured_unit, purchased_date = excluded.purchased_date, opened_date = excluded.opened_date;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.food_pantry_items WHERE id = 'new') <> 1 OR
    NOT EXISTS (SELECT 1 FROM public.food_pantry_items WHERE id = 'new' AND name = 'Milk edited'
      AND structured_quantity = 2 AND structured_unit = 'piece'
      AND purchased_date IS NULL AND opened_date IS NULL AND added_at = '2026-09-01T08:00:00Z')
  THEN RAISE EXCEPTION 'same-row edit failed'; END IF;
END $$;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$
DECLARE changed integer;
BEGIN
  UPDATE public.food_pantry_items SET name = 'Wrong owner' WHERE id = 'old';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'cross-user update allowed'; END IF;
END $$;
RESET ROLE;
SELECT 'APP-050 database migration checks passed' AS result;
