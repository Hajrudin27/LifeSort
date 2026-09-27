-- APP-055 post-Staging hardening: pin the search_path on the two window constants.
--
-- Supabase Security Advisor flagged `Function Search Path Mutable` on
-- public.document_release_reauth_window() and public.document_release_window()
-- after APP-055 reached Staging. Neither was given a `SET search_path`, so each
-- inherits whatever the calling role has — and a function that resolves objects
-- through a caller-controlled path is a place where a later change can quietly
-- start meaning something else.
--
-- Today neither is exploitable: both bodies are a single built-in interval
-- literal and resolve no application object at all. This is therefore about
-- posture, not an incident — the warning is closed before Production rather than
-- carried into it, and the next person to edit these bodies inherits a pinned
-- path instead of an open one.
--
-- pg_catalog, not an application schema, precisely because there is nothing of
-- ours to find: the smallest path that can still resolve `interval`.
--
-- Semantics are untouched. ALTER FUNCTION ... SET changes only how names inside
-- the body resolve; it does not recreate the function, so the return values, the
-- volatility, the ownership and the existing REVOKE/GRANT all stand. The 5-minute
-- reauthentication window and the 15-minute release window remain exactly as
-- reviewed, and tests/db/app055.test.cjs asserts both facts side by side.
--
-- Forward-only: 20260925090000_private_document_bucket.sql is already applied to
-- Staging and is left byte-for-byte alone.

ALTER FUNCTION public.document_release_reauth_window()
  SET search_path = pg_catalog;

ALTER FUNCTION public.document_release_window()
  SET search_path = pg_catalog;
