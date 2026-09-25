-- APP-055: standalone private documents.
--
-- A document the user uploads on its own is not an attachment to something else.
-- `public.attachments` is parent-oriented — every row must name a warranty or an
-- expense — so storing standalone documents there would mean inventing an owner
-- that does not exist. This is its own metadata table and its own private bucket.
--
-- Additive only. Nothing in `attachments`, its bucket or its policies is touched.

CREATE TABLE public.documents (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  original_name text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Account-lifecycle marker, and nothing else.
  --
  -- Set only by release_my_documents_for_account_deletion(), only for the
  -- caller's own rows, and only ever account-wide. While it is NULL the object
  -- behind this row cannot be deleted through Storage at all; while it is recent
  -- the account-deletion flow may remove the bytes — and the row, with its
  -- canonical path, is still here so a failed attempt can be retried.
  --
  -- It is a WINDOW, not a state. The timestamp says when the account last asked
  -- to be deleted, and authorization reads it against document_release_window()
  -- below. An abandoned deletion therefore re-protects its own documents by
  -- doing nothing: the stored value goes stale on its own, and a stale value
  -- grants nothing. Nothing clears it, because nothing needs to.
  --
  -- It is deliberately NOT an APP-056 deletion state. APP-056 owns per-document
  -- deletion, which selects one document and removes its metadata too; this
  -- selects nothing and removes nothing.
  account_deletion_released_at timestamptz,

  CONSTRAINT documents_pkey PRIMARY KEY (id),

  -- The object path is derived, never supplied as a free choice. Without this,
  -- a row could claim an object belonging to someone else, or an object that the
  -- Storage policy would never have let this user create. Identity and location
  -- are the same fact, so the database holds them together.
  CONSTRAINT documents_storage_path_canonical
    CHECK (storage_path = user_id::text || '/' || id::text),

  -- One row per object. A second row pointing at the same object would survive
  -- the first row's deletion and keep a file reachable that the user deleted.
  CONSTRAINT documents_storage_path_unique UNIQUE (storage_path),

  -- The original filename is the only thing the user recognises the file by, so
  -- it may not be blank; it is bounded because it is display text, not a key.
  CONSTRAINT documents_original_name_nonblank
    CHECK (btrim(original_name) <> '' AND length(original_name) <= 255)
);

COMMENT ON TABLE public.documents IS
  'APP-055: standalone private user documents. Metadata only; bytes live in the private documents bucket.';

CREATE INDEX idx_documents_user_created ON public.documents (user_id, created_at DESC);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_owner_select
  ON public.documents FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- The canonical-path CHECK already binds identity to location for every writer.
-- Repeating the user half here is deliberate: the policy then states the whole
-- rule on its own, so reading it does not require also reading the constraint.
CREATE POLICY documents_owner_insert
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND storage_path = auth.uid()::text || '/' || id::text
  );

-- No UPDATE policy: a document's identity, path and original name are fixed once
-- written, and `account_deletion_released_at` is set only by the SECURITY DEFINER
-- release below — never by a client statement. No DELETE policy: APP-056 owns the
-- user-facing delete cascade, and an unpaired metadata delete would strand the
-- object it points at. Account deletion does not need one either; the rows live
-- until the FK above cascades them from auth.users, which is exactly what keeps a
-- failed Storage removal retryable.

REVOKE ALL ON public.documents FROM anon, authenticated;

-- Column-level INSERT, not table-level. `created_at` has a server default, but a
-- default only decides what happens when the client stays silent — with a
-- table-level grant a modified client could simply send its own value and date a
-- document whenever it liked. The four columns below are the only ones the client
-- owns; the creation time is the server's.
GRANT SELECT ON public.documents TO authenticated;
GRANT INSERT (id, user_id, storage_path, original_name) ON public.documents TO authenticated;

-- The bucket. Private, and with the same conservative 25 MiB server-side ceiling
-- the attachments bucket already uses (20260906190000): without a limit any
-- signed-in user can fill the storage quota. No allowed_mime_types, because the
-- point of the module is that the user may keep arbitrary documents.
-- DO UPDATE, not DO NOTHING. A bucket named `documents` may already exist in an
-- environment from before this migration, and leaving whatever settings it has is
-- how a public bucket or a missing size limit survives the thing meant to fix it.
-- The invariants are asserted, not merely proposed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 25 * 1024 * 1024, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY "Users can upload own documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- How recently the account must have proved its password before it may open an
-- account-deletion release.
--
-- Five minutes, matching the APP-024 reauthentication window the app already
-- reasons in. The delete screen signs in with the password immediately before
-- calling this, so the real gap is seconds; the window only has to be long
-- enough that the attachment sweep in front of it cannot outlast it.
CREATE OR REPLACE FUNCTION public.document_release_reauth_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '5 minutes' $$;

REVOKE ALL ON FUNCTION public.document_release_reauth_window() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.document_release_reauth_window() TO authenticated;

-- Did this session prove the account's password recently?
--
-- Supabase Auth records, per session, which methods verified the identity and
-- WHEN: GoTrue writes a row into auth.mfa_amr_claims at each authentication
-- event and mints `amr` from those rows, so an entry's timestamp is the moment
-- the method was used. That is the distinction this gate depends on — `iat`
-- moves every time the access token is refreshed, while an `amr` timestamp does
-- not, because refreshing a token performs no authentication and writes no
-- claim. A stolen session can therefore keep itself alive indefinitely and still
-- never satisfy this.
--
-- The shape and the `jsonb_path_query((select auth.jwt()), '$.amr[0]')` access
-- pattern are Supabase's own, documented for exactly this: "you can mandate that
-- access will be only be granted ... to users who have recently signed in with a
-- password". Every branch fails closed — a missing claim, the RFC-8176 string
-- form a custom access-token hook may emit, a non-numeric timestamp, or no
-- password entry at all all mean "no".
--
-- Read honestly, this proves RECENT PASSWORD AUTHENTICATION. It does not prove
-- that the user asked to delete their account; nothing available here can. What
-- it removes is the case the Storage policy actually fears: a session held by
-- someone who never knew the password.
CREATE OR REPLACE FUNCTION public.has_recent_password_authentication()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(coalesce(auth.jwt(), '{}'::jsonb) -> 'amr') = 'array'
          THEN auth.jwt() -> 'amr'
        ELSE '[]'::jsonb
      END
    ) AS entry
    WHERE jsonb_typeof(entry) = 'object'
      AND entry ->> 'method' = 'password'
      AND entry ->> 'timestamp' ~ '^[0-9]+$'
      AND to_timestamp((entry ->> 'timestamp')::numeric)
            > now() - public.document_release_reauth_window()
  );
$$;

REVOKE ALL ON FUNCTION public.has_recent_password_authentication() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_recent_password_authentication() TO authenticated;

-- How long an account-deletion release stays good for.
--
-- One constant, in one place, so the policy and the documentation cannot drift
-- apart. 15 minutes is sized to the flow it authorizes: releasing, removing a
-- handful of objects and calling delete_my_account is seconds of work, and a
-- user who retries after a failure calls the release again and gets a new
-- window. Anything longer would only widen the period in which an abandoned
-- deletion leaves live documents deletable.
CREATE OR REPLACE FUNCTION public.document_release_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '15 minutes' $$;

REVOKE ALL ON FUNCTION public.document_release_window() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.document_release_window() TO authenticated;

-- Two narrow reasons to delete, and nothing else.
--
-- The upload writes the object before the metadata row, so a failed insert must
-- be able to take its own object back out again. But "may delete my own objects"
-- is wider than that need: it would also let a modified client destroy the bytes
-- of a document that is already stored, leaving its row behind pointing at
-- nothing. It is worse than that — an insert can commit on the server while the
-- client still sees an error, and the client would then compensate away a file
-- its own metadata row now claims.
--
-- Account deletion needs the second reason. Its documents all have rows, so the
-- compensation rule alone would refuse them; the release below marks them, and a
-- recent mark is the account saying "this whole account is going, right now".
--
--   no row                         -> failed-upload orphan, removable
--   row, no release                -> a stored document, NOT removable
--   row, release within the window -> removable by the account-deletion flow
--   row, release older than that   -> a stored document again, NOT removable
--   someone else's prefix          -> never
--
-- The fourth line is the point of the window. A deletion that fails, is
-- cancelled or dies midway leaves the account alive with its rows still marked;
-- without an expiry those documents would stay deletable forever, and an
-- abandoned attempt would have permanently weakened the protection on files the
-- user still owns. The comparison uses the database clock — a client clock is
-- an input, not a source of authority.
--
-- The check runs as SECURITY DEFINER rather than as a subquery in the policy, so
-- it does not depend on what the caller can see through the metadata table's own
-- RLS. It answers only for the caller's own prefix, so it cannot be used as an
-- oracle for whether some other user has a document at a guessed path. Note what
-- it is NOT: it takes no user id, and a caller-supplied path is a question, never
-- an authorization — the authorization is the release state on the row.
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
      -- A row blocks deletion unless it carries a release inside the window.
      SELECT 1
      FROM public.documents d
      WHERE d.storage_path = p_name
        AND (
          d.account_deletion_released_at IS NULL
          OR d.account_deletion_released_at <= now() - public.document_release_window()
        )
    );
$$;

REVOKE ALL ON FUNCTION public.document_object_is_deletable(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.document_object_is_deletable(text) TO authenticated;

-- Superseded name from an earlier revision of this unmerged migration.
DROP FUNCTION IF EXISTS public.document_object_is_orphan(text);

CREATE POLICY "Users can delete own unreferenced or released documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.document_object_is_deletable(name)
  );

-- Account deletion needs one more thing now that object removal is allowed only
-- while no metadata row points at the object.
--
-- APP-022 removes files BEFORE the account, because afterwards the session that
-- may touch them is gone. But the metadata rows only disappear with the account,
-- so at the moment the client wants to remove its document objects every one of
-- them still has a row and the compensation rule correctly refuses.
--
-- The obvious way out — delete the rows first, then the bytes — is wrong, and
-- was wrong here before this function replaced it. Deleting the row destroys the
-- only record of where the object is. If the Storage call then fails, the
-- account survives, the file survives, and the next attempt has nothing left to
-- rediscover it by: the object is stranded, and the service-role sweep is a
-- backstop for exceptional loss, not a licence to create it on purpose.
--
-- So this releases without destroying. It marks the account's documents as
-- released for account deletion and hands back their paths; the rows, and with
-- them the canonical paths, stay exactly where they are until auth.users is
-- deleted and the cascade takes them. A failed Storage removal therefore leaves
-- the next attempt able to rediscover the same object and try again.
--
-- Every call sets a FRESH timestamp, deliberately. The release is a window, not
-- a latch: keeping the first attempt's timestamp would mean a retry after the
-- window had closed could never re-authorize anything, and the user would be
-- left unable to finish deleting their own account. Idempotence here is
-- semantic, not literal — repeat it as often as you like and the answer is the
-- same set of paths, each usable for the next short while.
--
-- It is an account-lifecycle primitive, not the APP-056 per-document cascade: it
-- is account-wide, selects nothing, takes no arguments — the caller cannot name
-- a user or a document — and removes no metadata. Being SECURITY DEFINER is not
-- what makes it safe; taking no input and touching only auth.uid()'s own rows is.
--
-- And `authenticated` alone is not enough to call it. A released document is a
-- deletable document, so a session that merely exists could otherwise release
-- the account, delete ONE object's bytes and stop — leaving exactly the dangling
-- row the Storage policy was written to prevent. The password check on the
-- deletion screen is UI, not authorization; the gate below is the server's own
-- reading of when this session last proved the account's password.
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

  -- Unconditional: a retry after the window closed must be able to open a new
  -- one. Repeating this adds no rows and removes none; it only moves the
  -- account's own release forward to now.
  UPDATE public.documents
  SET account_deletion_released_at = now()
  WHERE user_id = v_user_id;

  -- Every path the account still owns, released now or on an earlier attempt.
  -- This is what makes the retry find the same object again.
  RETURN QUERY
    SELECT d.storage_path
    FROM public.documents d
    WHERE d.user_id = v_user_id
    ORDER BY d.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.release_my_documents_for_account_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_my_documents_for_account_deletion() TO authenticated;

-- An intermediate revision of this unmerged migration shipped a destructive
-- release. It is removed rather than left sitting unused, so no environment that
-- ran that revision keeps a way to delete document metadata directly.
DROP FUNCTION IF EXISTS public.delete_my_document_metadata();

-- Storage objects do not cascade with auth.users, exactly as recorded for
-- attachments in 20260907090000. The client removes its own objects before
-- calling delete_my_account(), but a client can die midway, so the same
-- service-role sweep must be able to find what was left behind.
--
-- This mirrors orphaned_attachment_paths rather than changing it: that function's
-- signature is the contract an existing operational sweep is written against, and
-- widening its result would break that caller silently.
CREATE OR REPLACE FUNCTION public.orphaned_document_paths(p_limit int DEFAULT 500)
RETURNS TABLE (path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND NOT EXISTS (
      -- The first folder IS the user id; the Storage policy enforces that on upload.
      SELECT 1
      FROM auth.users u
      WHERE u.id::text = (storage.foldername(o.name))[1]
    )
  ORDER BY o.created_at
  LIMIT greatest(1, least(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.orphaned_document_paths(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphaned_document_paths(int) TO service_role;
