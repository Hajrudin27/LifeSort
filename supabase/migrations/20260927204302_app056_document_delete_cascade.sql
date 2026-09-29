-- APP-056: per-document delete cascade.
--
-- APP-055 made documents storable and readable and deliberately gave the user no
-- way to delete one. This adds that way, as a two-phase lifecycle per document:
--
--   begin_my_document_deletion(id)      opens a short deletion window on ONE owned row
--   Storage API .remove([path])         the client removes that one object inside it
--   finalize_my_document_deletion(id)   checks the object is gone, then writes a
--                                       tombstone and deletes the row, together
--
-- What is NOT here matters as much. There is no client DELETE on public.documents,
-- and the Storage DELETE policy is not widened to "anything under my own prefix":
-- either one would let a modified client destroy a stored document's bytes and
-- leave its row behind — the dangling row APP-055 exists to prevent. The object
-- goes first, while the row still holds the canonical path, so a failed Storage
-- call can simply be retried against the same object; the row goes last, and only
-- once the server itself has seen that the object is gone. And for that "gone" to
-- stay true through finalize's commit, the Storage INSERT policy refuses any path
-- already claimed by an active row or a tombstone.
--
-- There are no OCR, thumbnail or other derived-document tables or objects in this
-- repository, so there is nothing derived to cascade. A future derived artifact
-- must be deletion-owned before it ships: a table references public.documents
-- ON DELETE CASCADE, and a derived Storage object joins this lifecycle.
--
-- Forward-only. Both APP-055 migrations are applied history and stay byte-for-byte
-- as they are; everything that changes is created or replaced here.

-- Per-document deletion request, and nothing else.
--
-- Set only by begin_my_document_deletion(), only on the caller's own row. It is a
-- WINDOW, exactly like account_deletion_released_at: authorization compares it with
-- document_delete_window() on the database clock, so a request that is abandoned —
-- the app closed, the network died, the object removal failed — protects the
-- document again on its own. Nothing clears it; a stale value grants nothing.
--
-- No grant changes. authenticated's INSERT grant is column-level and does not name
-- this column, and there is no UPDATE or DELETE grant at all, so no client
-- statement can set, clear or backdate it.
ALTER TABLE public.documents
  ADD COLUMN deletion_requested_at timestamptz;

COMMENT ON COLUMN public.documents.deletion_requested_at IS
  'APP-056: when the owner last asked to delete this one document. Set only by begin_my_document_deletion(); authorizes Storage removal only within document_delete_window().';

-- How long a per-document deletion request stays good for.
--
-- Its own constant rather than document_release_window(). Account deletion and
-- per-document deletion are different capabilities with different authorization,
-- and sharing one constant would couple a change to either to the other. The value
-- is the same 15 minutes for the same reason: begin, one Storage call and finalize
-- are seconds of work, and anything longer only widens the time an abandoned
-- request leaves a live document deletable.
--
-- The search_path is pinned from creation — the lesson of the APP-055 hardening.
-- The body resolves nothing of ours, so pg_catalog is the whole path.
CREATE FUNCTION public.document_delete_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT interval '15 minutes' $$;

-- Read only from inside the SECURITY DEFINER functions below, which run as their
-- owner. No client role needs to call it, so none can.
REVOKE ALL ON FUNCTION public.document_delete_window() FROM public, anon, authenticated;

-- Deletion evidence: this account deleted this document id, at this time.
--
-- Deliberately minimal. No filename, path, MIME type, URL, content or anything
-- derived from them — a tombstone must not become a second copy of the metadata
-- the user asked to delete.
--
-- Why it exists at all: once the active row is gone, "no row" is ambiguous. It
-- could mean deleted, never existed, or someone else's. The tombstone lets the
-- server say "already deleted" — together with the absence of the canonical
-- object, never on its own — so a retry after a lost response settles to success
-- rather than an error; it lets the database refuse a stale client that writes the
-- same id back; it keeps the canonical path non-insertable for ordinary clients
-- (the Storage INSERT policy below); and it keeps that path findable for the
-- account's own cleanup should anomalous bytes ever be found there.
--
-- Account-bound: it cascades with auth.users like every other user table, so
-- account deletion takes it too. There is deliberately no foreign key to
-- public.documents — it has to outlive the row it records.
CREATE TABLE public.document_deletion_tombstones (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  document_id uuid        NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_deletion_tombstones_pkey PRIMARY KEY (user_id, document_id)
);

COMMENT ON TABLE public.document_deletion_tombstones IS
  'APP-056: minimal per-account evidence that a document id was deleted. No filename, path or content. Written only by finalize_my_document_deletion().';

ALTER TABLE public.document_deletion_tombstones ENABLE ROW LEVEL SECURITY;

-- No policies and no client grants. Clients learn "already deleted" through the two
-- functions below, which answer only about the caller's own ids; nothing needs to
-- read, write or delete this table directly, so nothing can. Supabase's default
-- privileges grant new public tables to anon and authenticated; this takes that
-- back, and deleted_at can therefore only ever be the server's default.
REVOKE ALL ON public.document_deletion_tombstones FROM public, anon, authenticated;

-- A deleted id stays deleted for that account.
--
-- The upload flow always mints a fresh crypto UUID, so an honest client never
-- writes an old id again. This is for the one that might — a stale or modified
-- client replaying an insert for a document the user already deleted — and it is
-- the database's rule, not the client's.
--
-- AFTER INSERT rather than BEFORE, on purpose. finalize_my_document_deletion()
-- writes the tombstone and deletes the row in one transaction. A concurrent insert
-- of the same id with a BEFORE check would look before that transaction committed,
-- find no tombstone, then wait on the primary key for the old row — and succeed the
-- moment the delete committed. An AFTER trigger runs only after that key check has
-- waited for finalize to finish, and under READ COMMITTED (every PostgREST request)
-- its query takes a fresh snapshot, so it sees the committed tombstone and refuses.
--
-- SECURITY DEFINER because the inserting role has no access to tombstones at all.
-- Trigger functions are not checked for EXECUTE when they fire, so no role is
-- granted it.
CREATE FUNCTION public.refuse_deleted_document_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.document_deletion_tombstones t
    WHERE t.user_id = NEW.user_id
      AND t.document_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'document_already_deleted';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_deleted_document_id() FROM public, anon, authenticated;

CREATE TRIGGER documents_refuse_deleted_id
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_deleted_document_id();

-- Open a deletion window on ONE of the caller's own documents.
--
-- Takes a document id and nothing else. The owner is auth.uid(), never an argument,
-- so there is no way to aim this at another account; and an id the caller does
-- not own gets exactly the answer an id that does not exist gets, so it cannot be
-- used to learn whether somebody else has a document.
--
--   ready            the window is open (or refreshed); here is the canonical path —
--                    or, for an id this account already deleted, bytes exist at
--                    its canonical path and still need removing
--   already-deleted  this account deleted this id AND no object exists at its
--                    canonical path; there is nothing to do
--   not-found        nothing of the caller's by that id
--
-- A tombstone alone never means "done". Metadata for a deleted id cannot come back,
-- and the Storage INSERT policy below keeps ordinary clients from uploading to its
-- canonical path. Bytes can still be there by other routes — written before this
-- policy existed, by an operator, or through a path that bypasses RLS — so this is
-- checked, not assumed: the lifecycle then runs once more, the object has no row so
-- the existing no-row reason lets the owner remove it, and finalize confirms it is
-- gone.
--
-- Every call sets a FRESH timestamp, so a retry after the window closed opens a new
-- one. Nothing is deleted here and the row keeps its canonical path, which is what
-- lets a failed Storage removal be retried against the same object.
--
-- It refuses outright if it could not later be finished. Finalize can only prove an
-- object is gone if this function's owner sees every row of storage.objects; if RLS
-- applied to it, a window opened here would make the bytes deletable while nothing
-- could ever confirm it and retire the row.
CREATE FUNCTION public.begin_my_document_deletion(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_path       text;
  v_active     boolean;
  v_tombstoned boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF row_security_active('storage.objects') THEN
    RAISE EXCEPTION 'document_storage_state_unverifiable';
  END IF;

  IF p_document_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;

  UPDATE public.documents d
     SET deletion_requested_at = now()
   WHERE d.id = p_document_id
     AND d.user_id = v_user_id
  RETURNING d.storage_path INTO v_path;
  v_active := FOUND;

  v_tombstoned := EXISTS (
    SELECT 1
    FROM public.document_deletion_tombstones t
    WHERE t.user_id = v_user_id
      AND t.document_id = p_document_id
  );

  -- An active row and a tombstone for one id is a state nothing here creates.
  -- Guessing which of the two is true would be worse than stopping, and raising
  -- also rolls back the timestamp just written.
  IF v_active AND v_tombstoned THEN
    RAISE EXCEPTION 'document_deletion_invariant_violated';
  END IF;

  IF v_active THEN
    RETURN jsonb_build_object('status', 'ready', 'storage_path', v_path);
  END IF;

  IF v_tombstoned THEN
    -- Derived from the server's own values, never from the client: the same
    -- canonical form the row's CHECK enforced while it existed.
    v_path := v_user_id::text || '/' || p_document_id::text;
    IF EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'documents'
        AND o.name = v_path
    ) THEN
      RETURN jsonb_build_object('status', 'ready', 'storage_path', v_path);
    END IF;
    RETURN jsonb_build_object('status', 'already-deleted');
  END IF;

  RETURN jsonb_build_object('status', 'not-found');
END;
$$;

REVOKE ALL ON FUNCTION public.begin_my_document_deletion(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.begin_my_document_deletion(uuid) TO authenticated;

-- Finish deleting ONE document — and only once its bytes are gone.
--
-- The server's own reading of storage.objects is the authority, never the client's
-- account of what its Storage call returned. A removal can look failed and have
-- worked, or look fine and not have, so the client always asks and this decides:
--
--   deleted          the object is absent: the tombstone is written and the row
--                    deleted, both in this one transaction
--   already-deleted  an earlier finalize did that already (its answer was lost),
--                    and no object exists at the canonical path now
--   object-present   the object still exists — for an active row, or at a deleted
--                    id's canonical path where anomalous bytes remain; nothing
--                    changed
--   not-requested    no fresh deletion request on the row; nothing changed
--   not-found        nothing of the caller's by that id
--
-- Finalize stays the authority on absence after the row is gone: a tombstone is
-- not an answer until storage.objects agrees.
--
-- The row is locked first, so two finalizes — or a finalize racing a begin —
-- serialize on it, and the second sees what the first committed.
--
-- "The object is absent" is only a proof if every row is visible. If this
-- function's owner were ever subject to RLS on storage.objects, an existing object
-- would read as missing and its row would be retired from under it, so that case
-- refuses instead of guessing.
CREATE FUNCTION public.finalize_my_document_deletion(p_document_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_path         text;
  v_requested_at timestamptz;
  v_active       boolean;
  v_tombstoned   boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF row_security_active('storage.objects') THEN
    RAISE EXCEPTION 'document_storage_state_unverifiable';
  END IF;

  IF p_document_id IS NULL THEN
    RETURN 'not-found';
  END IF;

  SELECT d.storage_path, d.deletion_requested_at
    INTO v_path, v_requested_at
    FROM public.documents d
   WHERE d.id = p_document_id
     AND d.user_id = v_user_id
   FOR UPDATE;
  v_active := FOUND;

  v_tombstoned := EXISTS (
    SELECT 1
    FROM public.document_deletion_tombstones t
    WHERE t.user_id = v_user_id
      AND t.document_id = p_document_id
  );

  IF v_active AND v_tombstoned THEN
    RAISE EXCEPTION 'document_deletion_invariant_violated';
  END IF;

  IF NOT v_active THEN
    IF NOT v_tombstoned THEN
      RETURN 'not-found';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'documents'
        AND o.name = v_user_id::text || '/' || p_document_id::text
    ) THEN
      RETURN 'object-present';
    END IF;
    RETURN 'already-deleted';
  END IF;

  IF v_requested_at IS NULL
     OR v_requested_at <= now() - public.document_delete_window() THEN
    RETURN 'not-requested';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'documents'
      AND o.name = v_path
  ) THEN
    RETURN 'object-present';
  END IF;

  INSERT INTO public.document_deletion_tombstones (user_id, document_id)
  VALUES (v_user_id, p_document_id);

  DELETE FROM public.documents d
   WHERE d.id = p_document_id
     AND d.user_id = v_user_id;

  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_my_document_deletion(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.finalize_my_document_deletion(uuid) TO authenticated;

-- Storage DELETE authorization, with the reviewed third reason.
--
-- APP-055 allowed exactly two: no row (failed-upload compensation), or a row whose
-- account-deletion release is fresh. APP-056 adds a third: a row whose per-document
-- deletion request is fresh.
--
--   own prefix, no row                                 -> removable (compensation)
--   own prefix, row, fresh account-deletion release    -> removable (account cleanup)
--   own prefix, row, fresh per-document request        -> removable (APP-056)
--   own prefix, row, neither fresh (NULL or stale)     -> NOT removable
--   someone else's prefix                              -> never
--
-- Written so that NULL can only ever refuse: comparing a NULL timestamp yields
-- NULL, coalesce turns that into false, and a row blocks unless one of the two
-- comparisons is actually true. The rest is APP-055's function unchanged: SECURITY
-- DEFINER so the answer does not depend on the caller's view of public.documents,
-- the same search_path, the constant false for a foreign prefix, and a path taken
-- as a question rather than as an authorization.
CREATE OR REPLACE FUNCTION public.document_object_is_deletable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (storage.foldername(p_name))[1] = auth.uid()::text
    AND NOT EXISTS (
      -- A row blocks deletion unless one of its lifecycle windows is fresh.
      SELECT 1
      FROM public.documents d
      WHERE d.storage_path = p_name
        AND NOT (
          coalesce(d.account_deletion_released_at > now() - public.document_release_window(), false)
          OR coalesce(d.deletion_requested_at > now() - public.document_delete_window(), false)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.document_object_is_deletable(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.document_object_is_deletable(text) TO authenticated;

-- Storage INSERT authorization: a path that is already claimed cannot be uploaded to.
--
-- APP-055 let an owner upload anything under their own prefix. That left a race in
-- finalize: it reads storage.objects, finds the canonical object absent, writes the
-- tombstone and deletes the row — and an upload to the same path that commits in
-- between is invisible to it, because a row lock cannot protect an object that does
-- not exist yet. Finalize would then report "deleted" over a stored object.
--
-- So an upload is allowed only to a path nothing claims:
--
--   own prefix, no row, no tombstone        -> insertable (a fresh upload, APP-055)
--   own prefix, an active row claims it      -> NOT insertable, object present or not
--   own prefix, an own tombstone claims it   -> NOT insertable
--   someone else's prefix                    -> never
--
-- The ordinary upload is untouched: it mints a new crypto id, uploads the object
-- while no row or tombstone exists, and only then inserts the row. What closes the
-- race is that finalize moves the claim from the row to the tombstone in ONE
-- transaction. A snapshot sees either all of that commit or none of it, so every
-- concurrent upload sees the row (before) or the tombstone (after), never neither.
--
-- Copy lands through INSERT as well, so it is covered; move and upsert-overwrite
-- need an UPDATE policy on the documents bucket, and there is none.
--
-- SECURITY DEFINER for the same reason as the delete helper: the answer must not
-- depend on the caller's view of public.documents, and the caller cannot read
-- tombstones at all. The Storage policy evaluates it as `authenticated`, so that
-- role needs EXECUTE; it answers only for the caller's own prefix and returns the
-- constant false for any other, so it reveals nothing about another account.
CREATE FUNCTION public.document_object_is_insertable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (storage.foldername(p_name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.storage_path = p_name
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.document_deletion_tombstones t
      WHERE t.user_id = auth.uid()
        AND t.user_id::text || '/' || t.document_id::text = p_name
    );
$$;

REVOKE ALL ON FUNCTION public.document_object_is_insertable(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.document_object_is_insertable(text) TO authenticated;

-- Replaced under the same name, with the same command and role; only the claim
-- check is added. A plain DROP, not IF EXISTS: this migration relies on APP-055's
-- policy being there, and should fail loudly rather than carry on if it is not.
-- Between the two statements the bucket has no INSERT policy at all, and with RLS
-- on that refuses every upload — the safe direction, however the migration is run.
DROP POLICY "Users can upload own documents" ON storage.objects;

CREATE POLICY "Users can upload own documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.document_object_is_insertable(name)
  );

-- Account deletion, made robust to an interrupted per-document deletion.
--
-- An APP-056 deletion can stop after the object is gone and before finalize
-- answered: the row is still here, the bytes are not. That document is already as
-- deleted as account deletion needs it to be, so the manifest should not send the
-- client after it again. The release therefore now hands back the owned paths whose
-- objects still EXIST in storage.objects — the ones that still need removal —
-- rather than every owned row's path.
--
-- An owned path is either an active row's canonical path or the canonical path of
-- one of this account's deletion tombstones. Ordinary clients cannot upload to a
-- tombstoned path (the INSERT policy above), but bytes can still be there by other
-- routes — from before that policy, from an operator, or through a bypass — and no
-- row can come back for them, so a manifest built from rows alone would miss them
-- and the account would be deleted with those bytes still in the bucket. This is
-- defense in depth, deliberately kept. Both derive the
-- same <user>/<uuid> form, and UNION keeps the manifest free of duplicates — which
-- both clients' all-or-nothing checks would otherwise reject outright.
--
-- Everything else is APP-055's release exactly: no arguments, auth.uid()'s own data
-- only, refused without recent password authentication before anything is written,
-- a fresh account_deletion_released_at on EVERY active owned row (a half-deleted one
-- included), no metadata removed, and the rows and tombstones left for the
-- auth.users cascade. A tombstone-derived object has no row, so the existing no-row
-- reason already lets the account remove it. The clients' all-or-nothing manifest
-- check is unchanged, and still satisfied: every path is canonical.
--
-- If this function cannot see every row of storage.objects, it cannot tell which
-- objects are gone, and answering "none" would strand bytes. It then over-reports —
-- every active row's path and every tombstone-derived path — because asking Storage
-- to remove an object that is already gone costs nothing, and leaving one behind is
-- the failure this whole lifecycle exists to prevent.
CREATE OR REPLACE FUNCTION public.release_my_documents_for_account_deletion()
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- The authorization boundary. Checked before anything is written, so a refused
  -- call leaves every release timestamp exactly as it was.
  IF NOT public.has_recent_password_authentication() THEN
    RAISE EXCEPTION 'reauthentication_required';
  END IF;

  UPDATE public.documents
  SET account_deletion_released_at = now()
  WHERE user_id = v_user_id;

  IF row_security_active('storage.objects') THEN
    RETURN QUERY
      SELECT owned.path
      FROM (
        SELECT d.storage_path AS path
        FROM public.documents d
        WHERE d.user_id = v_user_id
        UNION
        SELECT t.user_id::text || '/' || t.document_id::text
        FROM public.document_deletion_tombstones t
        WHERE t.user_id = v_user_id
      ) AS owned
      ORDER BY owned.path;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT owned.path
    FROM (
      SELECT d.storage_path AS path
      FROM public.documents d
      WHERE d.user_id = v_user_id
      UNION
      SELECT t.user_id::text || '/' || t.document_id::text
      FROM public.document_deletion_tombstones t
      WHERE t.user_id = v_user_id
    ) AS owned
    WHERE EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'documents'
        AND o.name = owned.path
    )
    ORDER BY owned.path;
END;
$$;

REVOKE ALL ON FUNCTION public.release_my_documents_for_account_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_my_documents_for_account_deletion() TO authenticated;
