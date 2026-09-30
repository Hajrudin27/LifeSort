-- APP-058: the trip as a canonical entity.
--
-- Until now a trip was a row with children that merely happened to name it. The
-- children (expenses, packing items, participants) carried a bare `trip_id` and no
-- foreign key, so they outlived the trip, and the client cleaned them up by issuing
-- a series of best-effort deletes from the phone. This makes the trip row the real
-- parent, gives it a destination, and lets it reference the user's standalone
-- documents (APP-055) instead of holding files of its own.
--
-- What is deliberately NOT here: no change to trips.id (it stays text, and the
-- global unique index APP-security added stays), no money migration, no packing
-- templates, no notification work, no broad grant hardening (APP-107), no
-- reservation entity, and no outbox/revision/tombstone columns.
--
-- Fail-closed. Every invariant below is introduced only if the data already obeys
-- it, and the migration stops with a count — never a row, a name or a destination —
-- when it does not. It never deletes or rewrites a user's data to make a constraint
-- fit. Forward-only: earlier migrations stay byte-for-byte as they are.

-- 1. Preconditions ------------------------------------------------------------

DO $$
DECLARE
  bad_dates bigint;
  orphan_expenses bigint;
  orphan_packing bigint;
  orphan_participants bigint;
  unexplained_expenses bigint;
  unexplained_packing bigint;
BEGIN
  SELECT count(*) INTO bad_dates FROM public.trips WHERE start_date > end_date;
  IF bad_dates > 0 THEN
    RAISE EXCEPTION 'APP-058: % trip(s) end before they start. Correct them first; nothing was changed.', bad_dates;
  END IF;

  SELECT count(*) INTO orphan_expenses FROM public.trip_expenses e
    WHERE NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = e.trip_id);
  IF orphan_expenses > 0 THEN
    RAISE EXCEPTION 'APP-058: % trip expense row(s) name a trip that does not exist. Resolve them first; nothing was changed.', orphan_expenses;
  END IF;

  SELECT count(*) INTO orphan_packing FROM public.trip_packing_items p
    WHERE NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p.trip_id);
  IF orphan_packing > 0 THEN
    RAISE EXCEPTION 'APP-058: % packing item row(s) name a trip that does not exist. Resolve them first; nothing was changed.', orphan_packing;
  END IF;

  SELECT count(*) INTO orphan_participants FROM public.trip_participants p
    WHERE NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p.trip_id AND t.user_id = p.owner_id);
  IF orphan_participants > 0 THEN
    RAISE EXCEPTION 'APP-058: % participant row(s) do not match their trip''s owner. Resolve them first; nothing was changed.', orphan_participants;
  END IF;

  -- user_id on a child row is its AUTHOR. A row is explained if its author is the
  -- trip's owner or an accepted participant of that trip. Anything else — a participant
  -- who was later removed or declined, or a row someone wrote under another identity —
  -- cannot be told apart from a forged row by looking at the data, so the migration will
  -- not decide: it stops, and a person who can see the rows resolves them. It neither
  -- deletes nor re-attributes them.
  SELECT count(*) INTO unexplained_expenses
  FROM public.trip_expenses e JOIN public.trips t ON t.id = e.trip_id
  WHERE e.user_id <> t.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.trip_participants p
      WHERE p.trip_id = e.trip_id AND p.owner_id = t.user_id AND p.user_id = e.user_id AND p.status = 'accepted');
  IF unexplained_expenses > 0 THEN
    RAISE EXCEPTION 'APP-058: % trip expense row(s) were written by someone who is neither the trip''s owner nor an accepted participant. Resolve them first; nothing was changed.', unexplained_expenses;
  END IF;

  SELECT count(*) INTO unexplained_packing
  FROM public.trip_packing_items i JOIN public.trips t ON t.id = i.trip_id
  WHERE i.user_id <> t.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.trip_participants p
      WHERE p.trip_id = i.trip_id AND p.owner_id = t.user_id AND p.user_id = i.user_id AND p.status = 'accepted');
  IF unexplained_packing > 0 THEN
    RAISE EXCEPTION 'APP-058: % packing item row(s) were written by someone who is neither the trip''s owner nor an accepted participant. Resolve them first; nothing was changed.', unexplained_packing;
  END IF;
END $$;

-- 2. Destination and date order -----------------------------------------------

-- Nullable, no default, no backfill: an existing trip never recorded one, and none
-- is invented. Legacy clients do not send the column and keep working.
ALTER TABLE public.trips ADD COLUMN destination text;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_destination_not_blank
  CHECK (destination IS NULL OR (btrim(destination) <> '' AND char_length(destination) <= 200));

COMMENT ON COLUMN public.trips.destination IS
  'APP-058: optional canonical destination, free text. Null for trips created before it existed.';

-- Both are calendar dates; a same-day trip is valid.
ALTER TABLE public.trips
  ADD CONSTRAINT trips_start_not_after_end
  CHECK (start_date <= end_date);

-- 3. The trip is the parent ---------------------------------------------------

-- trips.id is globally unique (trips_id_globally_unique), which is what lets a child
-- that carries only trip_id reference it. user_id on these two tables is the row's
-- AUTHOR — an accepted participant may have written it — so the reference is to the
-- trip alone, never to (author, trip).
ALTER TABLE public.trip_expenses
  ADD CONSTRAINT trip_expenses_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES public.trips (id) ON DELETE CASCADE;

ALTER TABLE public.trip_packing_items
  ADD CONSTRAINT trip_packing_items_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES public.trips (id) ON DELETE CASCADE;

-- A participant row is owner-bound: its owner_id must be the trip's owner, which
-- the trip's primary key (user_id, id) can express as a pair.
ALTER TABLE public.trip_participants
  ADD CONSTRAINT trip_participants_trip_owner_fkey
  FOREIGN KEY (owner_id, trip_id) REFERENCES public.trips (user_id, id) ON DELETE CASCADE;

-- The cascade looks children up by trip_id for every deleted trip.
CREATE INDEX IF NOT EXISTS trip_expenses_trip_id_idx ON public.trip_expenses (trip_id);
CREATE INDEX IF NOT EXISTS trip_packing_items_trip_id_idx ON public.trip_packing_items (trip_id);

-- 4. Who may write a child row ------------------------------------------------

-- With no foreign key, the own-row policies could not tell a row for my trip from
-- a row for anyone's. Now that a child must name a real trip, they must also name
-- one I am allowed to write to: my own, or one I am an accepted participant of.
-- Otherwise anyone who learned a trip id (a pending invitee sees it) could write
-- rows into someone else's trip. Reading and deleting one's own rows is unchanged.
-- "Do I own this trip?" for the write policies below. It is VOLATILE on purpose. A STABLE
-- function (or an inline subquery) is judged by the snapshot the whole statement started
-- with; a packing row whose trip committed while that statement was waiting (see section 8)
-- would then be refused for a trip that plainly exists. A VOLATILE function takes a fresh
-- snapshot for its own query. It answers only about the caller's own ownership, so it is no
-- oracle about anyone else's trips; search_path is pinned and only `authenticated` may run it.
CREATE FUNCTION public.trip_is_owned_by_caller(p_trip_id text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p_trip_id AND t.user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.trip_is_owned_by_caller(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_is_owned_by_caller(text) TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own trip expenses" ON public.trip_expenses;
CREATE POLICY "Users can insert their own trip expenses" ON public.trip_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.trip_is_owned_by_caller(trip_id)
      OR public.can_access_trip_row(trip_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own trip expenses" ON public.trip_expenses;
CREATE POLICY "Users can update their own trip expenses" ON public.trip_expenses
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.trip_is_owned_by_caller(trip_id)
      OR public.can_access_trip_row(trip_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert their own packing items" ON public.trip_packing_items;
CREATE POLICY "Users can insert their own packing items" ON public.trip_packing_items
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.trip_is_owned_by_caller(trip_id)
      OR public.can_access_trip_row(trip_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own packing items" ON public.trip_packing_items;
CREATE POLICY "Users can update their own packing items" ON public.trip_packing_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.trip_is_owned_by_caller(trip_id)
      OR public.can_access_trip_row(trip_id, auth.uid())
    )
  );

-- An accepted participant may write a row only under their OWN identity. The older
-- participant INSERT policies checked can_access_trip_row(trip_id, user_id), which also
-- accepts the owner or another accepted participant as the author — so a participant
-- could have written a row that looked like the owner's. Those policies are redundant
-- now: the own-row INSERT policy above already authorises an accepted participant's own
-- row. They are dropped rather than narrowed so there is one rule, not two OR-ed ones.
DROP POLICY IF EXISTS "Participants can insert shared trip expenses" ON public.trip_expenses;
DROP POLICY IF EXISTS "Participants can insert shared packing items" ON public.trip_packing_items;

-- Identity is not editable. Collaborative editing of a row's CONTENT stays as it was
-- (a participant may still update, and delete, rows on a trip they belong to), but no
-- update — by owner, participant or anyone — may change which row it is, who wrote it,
-- or which trip it belongs to. RLS cannot compare old and new; a row trigger can. On
-- trips the same rule stops an update from handing a trip to someone else.
CREATE FUNCTION public.trip_identity_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'trip_identity_immutable' USING ERRCODE = '42501';
  END IF;
  -- Nested on purpose: PL/pgSQL resolves NEW.trip_id when it plans the expression, so it
  -- must not appear in a statement that runs for trips, which has no such column.
  IF TG_TABLE_NAME <> 'trips' THEN
    IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
      RAISE EXCEPTION 'trip_identity_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_identity_is_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trips_identity_immutable BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trip_identity_is_immutable();
CREATE TRIGGER trip_expenses_identity_immutable BEFORE UPDATE ON public.trip_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trip_identity_is_immutable();
CREATE TRIGGER trip_packing_items_identity_immutable BEFORE UPDATE ON public.trip_packing_items
  FOR EACH ROW EXECUTE FUNCTION public.trip_identity_is_immutable();

-- 5. The owner can read what belongs to their trip ----------------------------

-- can_access_trip_row() answers "may I, as an accepted participant, see this row",
-- and is deliberately unchanged: it is SECURITY DEFINER, it closed real
-- cross-account holes, and giving it an owner branch would also have made it a
-- WRITE authorisation that lets an owner stamp any author id on a row. A row a
-- participant wrote is the owner's trip's data, so the owner gets a plain SELECT
-- policy — nothing else. The subquery runs under the caller's own RLS, which lets
-- an owner see their own trips and nobody else's.
CREATE POLICY "Trip owners can view rows of their trips" ON public.trip_expenses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Trip owners can view rows of their trips" ON public.trip_packing_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

-- 6. Documents are referenced, never copied -----------------------------------

-- A link between one of my trips and one of my documents. It holds two ids and the
-- time it was made: no filename, no storage path, no URL, no bytes. Both foreign
-- keys are owner-bound, so a trip and a document of different accounts cannot be
-- linked, and both cascade: deleting a trip removes the link and keeps the document;
-- deleting the document (APP-056 finalize, or the account) removes the link and
-- keeps the trip. Nothing dangles in either direction.
CREATE TABLE public.trip_document_references (
  user_id uuid NOT NULL,
  trip_id text NOT NULL,
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_document_references_pkey PRIMARY KEY (user_id, trip_id, document_id),
  CONSTRAINT trip_document_references_trip_fkey
    FOREIGN KEY (user_id, trip_id) REFERENCES public.trips (user_id, id) ON DELETE CASCADE,
  CONSTRAINT trip_document_references_document_fkey
    FOREIGN KEY (user_id, document_id) REFERENCES public.documents (user_id, id) ON DELETE CASCADE
);

-- The document-side cascade looks links up by document.
CREATE INDEX trip_document_references_document_idx
  ON public.trip_document_references (user_id, document_id);

COMMENT ON TABLE public.trip_document_references IS
  'APP-058: owner-only links from a trip to a standalone document. Ids only; deleting either side removes the link and keeps the other.';

ALTER TABLE public.trip_document_references ENABLE ROW LEVEL SECURITY;

-- Owner only. A linked document is the owner's private file; linking it to a trip
-- other people are invited to does not share it, so participants see no link rows
-- and the relation cannot be used to learn that a document exists.
CREATE POLICY trip_document_references_owner_select ON public.trip_document_references
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY trip_document_references_owner_insert ON public.trip_document_references
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY trip_document_references_owner_delete ON public.trip_document_references
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Explicit grants for this new relation only. The creation time is the server's:
-- INSERT is granted per column and does not name created_at. No UPDATE at all — a
-- link is made or removed, never edited.
REVOKE ALL ON public.trip_document_references FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.trip_document_references TO authenticated;
GRANT INSERT (user_id, trip_id, document_id) ON public.trip_document_references TO authenticated;

-- 7. The deletion preview -----------------------------------------------------

-- What deleting this trip would remove, counted by the server, for the owner only.
-- Counts span every author (a participant's rows go with the trip), which is why
-- this is SECURITY DEFINER: the owner's own RLS would hide none of it now, but a
-- count that depended on that would silently become wrong if a policy changed.
--
-- The answer to "not yours" must not reveal whether an id exists to someone with no
-- business knowing: an accepted participant learns 'not-owner' (they can already see
-- the trip), everyone else gets 'not-found', identical to an id that does not exist.
CREATE FUNCTION public.trip_deletion_preview(p_trip_id text)
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT t.user_id INTO v_owner FROM public.trips t WHERE t.id = p_trip_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  IF v_owner <> v_uid THEN
    IF EXISTS (
      SELECT 1 FROM public.trip_participants p
      WHERE p.trip_id = p_trip_id AND p.owner_id = v_owner
        AND p.user_id = v_uid AND p.status = 'accepted'
    ) THEN
      RETURN jsonb_build_object('status', 'not-owner');
    END IF;
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'expenses', (SELECT count(*) FROM public.trip_expenses e WHERE e.trip_id = p_trip_id),
    'packing_items', (SELECT count(*) FROM public.trip_packing_items i WHERE i.trip_id = p_trip_id),
    'participants', (SELECT count(*) FROM public.trip_participants p WHERE p.trip_id = p_trip_id AND p.owner_id = v_owner),
    'documents', (SELECT count(*) FROM public.trip_document_references r WHERE r.trip_id = p_trip_id AND r.user_id = v_owner)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trip_deletion_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_deletion_preview(text) TO authenticated;

-- 8. TEMPORARY compatibility buffer for the pre-APP-058 initial-packing race ------

-- A client built before APP-058 creates a trip by sending the trip row and its default
-- packing list as two independent, concurrent requests. Each is its own transaction, so
-- if the packing request commits first, the trip does not exist yet and the foreign key
-- (correctly) refuses it — silently, because that client ignores the error.
--
-- The canonical model stays exactly as above: trip_packing_items.trip_id references
-- trips(id) ON DELETE CASCADE, and nothing is weakened. This adds a side door that is
-- NOT canonical Travel storage and NOT a general queue: a row that arrives for a trip
-- that does not exist yet is set aside here, and when that trip is created by the same
-- account it is replayed into trip_packing_items and removed from here. Nothing is
-- invented to make the foreign key pass, nothing is retried, and no sleep holds a connection.
-- A request may briefly wait for another request's own single transaction, because the
-- triggers below serialise through advisory transaction locks; that wait is deliberate.
--
-- It exists only for that one race, only for packing items, and only until pre-APP-058
-- clients are no longer supported. REMOVAL: drop the two triggers, the two functions, the
-- window function and this table in a forward-only migration.

-- How long a set-aside row stays adoptable. The race is between two requests sent
-- together, so seconds would do; 15 minutes leaves room for a slow connection without
-- leaving a row adoptable indefinitely. Past it a row is never adopted.
CREATE FUNCTION public.trip_packing_compat_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT interval '15 minutes' $$;

REVOKE ALL ON FUNCTION public.trip_packing_compat_window() FROM PUBLIC, anon, authenticated;

-- Only what is needed to replay the original packing row, and when it was set aside.
-- The primary key is the canonical row's identity, (user_id, id): an old client that
-- retries the same request sets the same row aside once, and adoption replays it once.
-- The author cascades with the account, so account deletion removes whatever is left.
CREATE TABLE public.trip_packing_compat_queue (
  user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id        text        NOT NULL,
  trip_id   text        NOT NULL,
  label     text        NOT NULL,
  checked   boolean     NOT NULL DEFAULT false,
  category  text        NOT NULL DEFAULT 'other',
  -- Wall-clock, not transaction-start: the triggers below can wait on a lock, and expiry is
  -- decided against real elapsed time.
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trip_packing_compat_queue_pkey PRIMARY KEY (user_id, id)
);

CREATE INDEX trip_packing_compat_queue_trip_idx ON public.trip_packing_compat_queue (trip_id);

COMMENT ON TABLE public.trip_packing_compat_queue IS
  'APP-058 TEMPORARY, server-only: packing rows from pre-APP-058 clients that arrived before their trip. Replayed into trip_packing_items when the same account creates the trip, never after the window. Not readable or writable by any client. Remove when pre-APP-058 clients are unsupported.';

-- Closed to every client. RLS is on with no policy as well, so a grant added by mistake
-- later still exposes nothing. Only the two trigger functions below touch this table.
ALTER TABLE public.trip_packing_compat_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_packing_compat_queue FROM PUBLIC, anon, authenticated;

-- The router. For an authenticated user's OWN packing row whose trip does not exist yet,
-- set it aside and skip the canonical insert. In every other case it does nothing, so the
-- normal path — trip first — goes straight into trip_packing_items and never touches the
-- queue, and every refusal (another account's row, a trip that exists but is not yours, no
-- session, a full queue) is still made by the policies and the foreign key, unchanged.
--
-- SECURITY DEFINER because the caller has no access to the queue; search_path is pinned
-- and every object is schema-qualified. The security boundary is NOT that a trip id is
-- hard to guess: a set-aside row is adopted only by a trip created by the same account,
-- and is otherwise never read by anyone.
--
-- One honest side effect: for an authenticated user, a packing insert naming a trip that
-- does not exist now succeeds (and is set aside) where one naming someone else's trip is
-- refused, so the two can be told apart. That says only whether a trip id exists, which
-- the client could already learn from the trip's own unique index, and it reveals nothing
-- about the trip.
--
-- The queue is bounded per account so it cannot be used as free storage.
CREATE FUNCTION public.trip_packing_route_early_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NEW.user_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  -- The two requests really do overlap, so "does the trip exist?" and "is anything set
  -- aside for it?" must not be answered on either side of the other request's commit: a
  -- row set aside just after the adopter looked would be orphaned, and a row inserted just
  -- before the trip committed would be refused. Both triggers therefore take the same
  -- per-trip transaction lock. Whoever is second waits only for the other's own
  -- transaction to finish (a single statement), then sees its result: the router sees the
  -- committed trip and inserts directly; the adopter sees the committed set-aside row.
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.trip:' || NEW.trip_id, 0));

  IF EXISTS (SELECT 1 FROM public.trips t WHERE t.id = NEW.trip_id) THEN
    RETURN NEW;
  END IF;

  -- The per-account cap must hold when two requests of one account, for DIFFERENT missing
  -- trips, arrive together: each holds its own trip lock, so without a second lock both
  -- would count 499 and both insert. The account lock makes cleanup -> count -> insert one
  -- step per account. LOCK ORDER is always trip lock, then account lock: the adopter holds
  -- a trip lock when its inner canonical insert fires this trigger again (re-entrant for the
  -- same trip, and it returns before reaching here because the trip exists), so nothing ever
  -- takes an account lock and then a trip lock. Other accounts are unaffected.
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.tripq:' || v_uid::text, 0));

  -- Opportunistic cleanup, this account's own expired rows only. There is no scheduler.
  DELETE FROM public.trip_packing_compat_queue q
  WHERE q.user_id = v_uid AND q.queued_at < clock_timestamp() - public.trip_packing_compat_window();

  IF (SELECT count(*) FROM public.trip_packing_compat_queue q WHERE q.user_id = v_uid) >= 500 THEN
    RETURN NEW; -- the foreign key refuses it, exactly as before
  END IF;

  INSERT INTO public.trip_packing_compat_queue (user_id, id, trip_id, label, checked, category)
  VALUES (NEW.user_id, NEW.id, NEW.trip_id, NEW.label, NEW.checked, NEW.category)
  ON CONFLICT (user_id, id) DO NOTHING;

  RETURN NULL; -- the canonical insert is skipped; the statement itself succeeds
END;
$$;

REVOKE ALL ON FUNCTION public.trip_packing_route_early_row() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trip_packing_items_route_early_row
  BEFORE INSERT ON public.trip_packing_items
  FOR EACH ROW EXECUTE FUNCTION public.trip_packing_route_early_row();

-- The adopter. When a trip row is created, replay the rows its OWNER set aside for it,
-- inside the same transaction as the trip. Matching is on both halves —
-- queued.trip_id = new.id AND queued.user_id = new.user_id — so an account that queued
-- rows for a trip id it did not go on to own gets nothing adopted. Rows past the window
-- are never adopted. ON CONFLICT DO NOTHING on the canonical identity makes a replay
-- exactly-once. Whatever is left for this trip id afterwards — adopted, expired, or set
-- aside by someone who is not the owner — can never be valid and is removed.
--
-- If the trip insert fails, this never commits, so nothing canonical appears and the set-
-- aside rows simply stay until their window closes.
CREATE FUNCTION public.trip_packing_adopt_early_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.trip:' || NEW.id, 0));

  INSERT INTO public.trip_packing_items (id, user_id, trip_id, label, checked, category)
  SELECT q.id, q.user_id, q.trip_id, q.label, q.checked, q.category
  FROM public.trip_packing_compat_queue q
  WHERE q.trip_id = NEW.id
    AND q.user_id = NEW.user_id
    AND q.queued_at >= clock_timestamp() - public.trip_packing_compat_window()
  ORDER BY q.queued_at, q.id
  ON CONFLICT (user_id, id) DO NOTHING;

  DELETE FROM public.trip_packing_compat_queue q WHERE q.trip_id = NEW.id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_packing_adopt_early_rows() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trips_adopt_early_packing_rows
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trip_packing_adopt_early_rows();

-- 9. Deleting a trip deletes what the user was shown --------------------------------

-- trip_deletion_preview() is the initial read. Deleting with a separate raw DELETE would
-- cascade whatever exists at that moment — including a dependency a participant added, or
-- another device of the owner added, between the preview and the confirmation. This is the
-- destructive half: it deletes the trip only if, AT THE MOMENT IT HOLDS THE TRIP ROW LOCKED,
-- the four dependency counts are exactly the ones the user confirmed.
--
-- Contract: delete_trip_if_dependencies_match(trip, expenses, packing_items, participants,
-- documents) -> jsonb
--   {"status":"deleted"}                          the trip row was deleted; cascades did the rest
--   {"status":"changed", "expenses":n, "packing_items":n, "participants":n, "documents":n}
--                                                 the counts differ; NOTHING was deleted; these
--                                                 are the fresh counts to show the user again
--   {"status":"not-owner"}                        an accepted participant
--   {"status":"not-found"}                        no such trip for this caller (missing, pending,
--                                                 unrelated — one answer, exactly as the preview)
--   raises not_authenticated                      no session
-- A missing or NULL expected count never matches, so it can never delete.
--
-- Ownership is proved BEFORE the row is locked, so a non-owner can neither block the owner nor
-- learn anything the preview would not tell them. The lock is FOR UPDATE: a child insert takes
-- a key-share lock on the trip row for its foreign key, which conflicts with FOR UPDATE, so a
-- child cannot commit between the recount and the delete — one already in flight finishes
-- first and is counted, one that arrives after waits and then fails its foreign key.
--
-- SECURITY DEFINER because the counts span every author and the owner's own RLS is not what
-- should decide them. search_path is pinned; only authenticated may execute it. Direct DELETE
-- on the owner's own trip remains permitted by the existing policy (APP-107's to revisit); a
-- modified client can bypass this check for its own data, but honest clients cannot race it.
CREATE FUNCTION public.delete_trip_if_dependencies_match(
  p_trip_id text,
  p_expenses integer,
  p_packing_items integer,
  p_participants integer,
  p_documents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_expenses bigint;
  v_packing bigint;
  v_participants bigint;
  v_documents bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT t.user_id INTO v_owner FROM public.trips t WHERE t.id = p_trip_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  IF v_owner <> v_uid THEN
    IF EXISTS (
      SELECT 1 FROM public.trip_participants p
      WHERE p.trip_id = p_trip_id AND p.owner_id = v_owner AND p.user_id = v_uid AND p.status = 'accepted'
    ) THEN
      RETURN jsonb_build_object('status', 'not-owner');
    END IF;
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  -- The owner. Lock the canonical row; if it went away while waiting, it is gone.
  PERFORM 1 FROM public.trips t WHERE t.id = p_trip_id AND t.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  SELECT count(*) INTO v_expenses FROM public.trip_expenses e WHERE e.trip_id = p_trip_id;
  SELECT count(*) INTO v_packing FROM public.trip_packing_items i WHERE i.trip_id = p_trip_id;
  SELECT count(*) INTO v_participants FROM public.trip_participants p WHERE p.trip_id = p_trip_id AND p.owner_id = v_uid;
  SELECT count(*) INTO v_documents FROM public.trip_document_references r WHERE r.trip_id = p_trip_id AND r.user_id = v_uid;

  IF p_expenses IS DISTINCT FROM v_expenses::integer
     OR p_packing_items IS DISTINCT FROM v_packing::integer
     OR p_participants IS DISTINCT FROM v_participants::integer
     OR p_documents IS DISTINCT FROM v_documents::integer THEN
    RETURN jsonb_build_object(
      'status', 'changed',
      'expenses', v_expenses, 'packing_items', v_packing,
      'participants', v_participants, 'documents', v_documents
    );
  END IF;

  DELETE FROM public.trips t WHERE t.id = p_trip_id AND t.user_id = v_uid;
  RETURN jsonb_build_object('status', 'deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_trip_if_dependencies_match(text, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip_if_dependencies_match(text, integer, integer, integer, integer) TO authenticated;
