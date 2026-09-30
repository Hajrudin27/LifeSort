-- APP-057: the warranty domain.
--
-- A warranty is tracked by what was bought, where, when, until when it is covered,
-- and which receipt proves it. The table already holds two of those facts under
-- older names, and they keep those names:
--
--   name          the product label (display text the user recognises it by)
--   expiry_date   the canonical coverage-end date; reminders derive from it alone
--
-- Renaming either would break every installed client's select and upsert at once,
-- so the semantics are recorded here and in ADR-0045 instead.
--
-- Added, all nullable, because existing rows never recorded them and nothing may be
-- invented for them:
--
--   purchase_date        calendar date of purchase, never after expiry_date
--   seller               free text, where it was bought
--   receipt_document_id  an OPAQUE reference to one of the owner's own APP-055
--                        standalone documents — never a copy of its bytes, its
--                        storage path, its filename or a signed URL
--
-- The reference is owner-bound by the database, not by the client: the foreign key
-- is composite over (user_id, receipt_document_id), so it can only ever resolve to a
-- document whose user_id is the warranty's own user_id — and RLS already pins that
-- user_id to auth.uid(). A foreign document id fails exactly like a missing one.
--
-- Deleting the document (APP-056 finalize, or the account cascade) must leave the
-- warranty in place and clear only the reference. The ON DELETE action is therefore
-- the column-list form SET NULL (receipt_document_id): a plain composite SET NULL
-- would null user_id too, which is NOT NULL and part of the primary key, and would
-- make every referenced document undeletable.
--
-- No policy, grant, function, bucket or Storage policy of APP-055/APP-056 changes.
-- The warranties RLS policies are not touched either. Legacy grant hardening is
-- APP-107's, not this story's.
--
-- Forward-only. Every earlier migration stays byte-for-byte as it is.

-- The three new facts. Nullable, no defaults, no backfill: an old row simply does
-- not know them.
ALTER TABLE public.warranties
  ADD COLUMN purchase_date date,
  ADD COLUMN seller text,
  ADD COLUMN receipt_document_id uuid;

COMMENT ON COLUMN public.warranties.name IS
  'APP-057: the product label. Kept under its original name for client compatibility.';
COMMENT ON COLUMN public.warranties.expiry_date IS
  'APP-057: the canonical coverage-end calendar date. Reminders derive from this date only.';
COMMENT ON COLUMN public.warranties.purchase_date IS
  'APP-057: optional calendar date of purchase. Never after expiry_date.';
COMMENT ON COLUMN public.warranties.seller IS
  'APP-057: optional seller, free text.';
COMMENT ON COLUMN public.warranties.receipt_document_id IS
  'APP-057: optional opaque reference to the owner''s own public.documents row. Cleared, never cascaded, when that document is deleted.';

-- A purchase cannot happen after its coverage ends. Both are calendar dates, so
-- the comparison is exact and has no timezone in it. Existing rows have no
-- purchase_date, so this validates trivially over them.
ALTER TABLE public.warranties
  ADD CONSTRAINT warranties_purchase_not_after_coverage_end
  CHECK (purchase_date IS NULL OR purchase_date <= expiry_date);

-- A foreign key needs a unique target over exactly its columns. id is already the
-- primary key, so (user_id, id) is unique by construction; this adds the index the
-- composite reference resolves through and changes nothing about which rows may
-- exist. No APP-055/APP-056 policy, grant or function reads it.
ALTER TABLE public.documents
  ADD CONSTRAINT documents_user_id_id_key UNIQUE (user_id, id);

-- The owner-bound receipt reference.
--
-- MATCH SIMPLE (the default): a NULL receipt_document_id is no reference and is not
-- checked. user_id is NOT NULL, so a non-NULL reference is always checked against
-- the pair. Referential checks bypass RLS by design, which is why the pair is the
-- whole check: the row's own user_id is the owner, and a document of any other
-- account is simply not present for it.
--
-- ON DELETE SET NULL (receipt_document_id): only the reference is cleared. user_id
-- is not in the list and cannot be touched by this action.
ALTER TABLE public.warranties
  ADD CONSTRAINT warranties_receipt_document_fkey
  FOREIGN KEY (user_id, receipt_document_id)
  REFERENCES public.documents (user_id, id)
  ON UPDATE NO ACTION
  ON DELETE SET NULL (receipt_document_id);

-- The delete action looks warranties up by (user_id, receipt_document_id) for every
-- deleted document. Only rows that actually reference something are indexed.
CREATE INDEX warranties_receipt_document_idx
  ON public.warranties (user_id, receipt_document_id)
  WHERE receipt_document_id IS NOT NULL;
