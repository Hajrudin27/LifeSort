-- APP-074: versioned, fail-closed governance for shared clinical reference content.
--
-- Legacy seed rows become v1 drafts. This is intentionally a visible-content reduction:
-- no historical row is represented as sourced, reviewed, current, or published without
-- evidence. The editorial RPCs below are the sole authenticated mutation surface.

-- The legacy text primary keys are product-facing logical IDs. Preserve them while
-- introducing a separate immutable identity for each editorial revision.
ALTER TABLE public.health_conditions
  ADD COLUMN IF NOT EXISTS revision_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_due_at date,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.symptom_glossary
  ADD COLUMN IF NOT EXISTS revision_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_due_at date,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Existing rows have one logical ID each under their former primary keys. Defaults above
-- deterministically make them v1 drafts and leave all provenance/review/publication fields
-- NULL. `revision_id` is set NOT NULL only after every historical row has a generated value.
UPDATE public.health_conditions
SET revision_id = gen_random_uuid()
WHERE revision_id IS NULL;
UPDATE public.symptom_glossary
SET revision_id = gen_random_uuid()
WHERE revision_id IS NULL;

ALTER TABLE public.health_conditions
  ALTER COLUMN revision_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS health_conditions_pkey,
  ADD CONSTRAINT health_conditions_pkey PRIMARY KEY (revision_id),
  ADD CONSTRAINT health_conditions_id_content_version_key UNIQUE (id, content_version),
  ADD CONSTRAINT health_conditions_content_version_positive CHECK (content_version > 0),
  ADD CONSTRAINT health_conditions_status_check CHECK (status IN ('draft', 'in_review', 'published', 'withdrawn')),
  ADD CONSTRAINT health_conditions_reviewed_pair_check CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  ADD CONSTRAINT health_conditions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(id);

ALTER TABLE public.symptom_glossary
  ALTER COLUMN revision_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS symptom_glossary_pkey,
  ADD CONSTRAINT symptom_glossary_pkey PRIMARY KEY (revision_id),
  ADD CONSTRAINT symptom_glossary_id_content_version_key UNIQUE (id, content_version),
  ADD CONSTRAINT symptom_glossary_content_version_positive CHECK (content_version > 0),
  ADD CONSTRAINT symptom_glossary_status_check CHECK (status IN ('draft', 'in_review', 'published', 'withdrawn')),
  ADD CONSTRAINT symptom_glossary_reviewed_pair_check CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  ADD CONSTRAINT symptom_glossary_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(id);

CREATE UNIQUE INDEX IF NOT EXISTS health_conditions_one_published_revision_per_id
  ON public.health_conditions (id) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS symptom_glossary_one_published_revision_per_id
  ON public.symptom_glossary (id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS health_conditions_mobile_eligibility_idx
  ON public.health_conditions (review_due_at, id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS symptom_glossary_mobile_eligibility_idx
  ON public.symptom_glossary (review_due_at, id) WHERE status = 'published';

COMMENT ON COLUMN public.health_conditions.id IS
  'Stable product logical ID. It is not a revision identity and remains the mobile route/common_symptoms reference.';
COMMENT ON COLUMN public.symptom_glossary.id IS
  'Stable product logical ID. It is not a revision identity.';
COMMENT ON COLUMN public.health_conditions.revision_id IS
  'Immutable row identity for one governed editorial revision (APP-074).';
COMMENT ON COLUMN public.symptom_glossary.revision_id IS
  'Immutable row identity for one governed editorial revision (APP-074).';

-- Published-only ordinary read access. This deliberately applies to owners and editors too:
-- their private editorial reads must use the explicit role-checked RPCs below.
DROP POLICY IF EXISTS "Authenticated users can read health conditions" ON public.health_conditions;
DROP POLICY IF EXISTS "Authenticated users can read symptom glossary" ON public.symptom_glossary;
DROP POLICY IF EXISTS "Admins can insert health conditions" ON public.health_conditions;
DROP POLICY IF EXISTS "Admins can update health conditions" ON public.health_conditions;
DROP POLICY IF EXISTS "Admins can delete health conditions" ON public.health_conditions;
DROP POLICY IF EXISTS "Admins can insert symptom glossary" ON public.symptom_glossary;
DROP POLICY IF EXISTS "Admins can update symptom glossary" ON public.symptom_glossary;
DROP POLICY IF EXISTS "Admins can delete symptom glossary" ON public.symptom_glossary;

CREATE POLICY "Published unexpired health conditions are readable"
  ON public.health_conditions FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND review_due_at >= (now() AT TIME ZONE 'Europe/Copenhagen')::date
  );
CREATE POLICY "Published unexpired symptom glossary is readable"
  ON public.symptom_glossary FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND review_due_at >= (now() AT TIME ZONE 'Europe/Copenhagen')::date
  );

REVOKE ALL ON TABLE public.health_conditions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.symptom_glossary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.health_conditions TO authenticated;
GRANT SELECT ON TABLE public.symptom_glossary TO authenticated;

-- Preserve unrelated historical audit values while adding the explicit clinical lifecycle.
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_action_check CHECK (
  action IN ('created', 'updated', 'deleted', 'replied', 'invited', 'confirmed',
             'revised', 'submitted', 'reviewed', 'returned', 'published', 'withdrawn')
);
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_entity_type_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_entity_type_check CHECK (
  entity_type IN ('price', 'offer', 'recipe', 'ticket', 'timeline_event', 'admin_user',
                  'waitlist_signup', 'health_condition', 'symptom_glossary')
);
-- REVOKE ALL (not only DML): RLS does not apply to TRUNCATE, so leaving that privilege would let any
-- API role empty the append-only trail. Admins keep read access through the existing SELECT policy.
REVOKE ALL ON TABLE public.activity_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.activity_log TO authenticated;

-- This helper is deliberately not an API. Every caller is a clinical lifecycle RPC and
-- derives the actor from auth.uid(). A failed append rolls back its caller's content change.
CREATE OR REPLACE FUNCTION public.app074_write_clinical_audit(
  p_action text,
  p_entity_type text,
  p_revision_id uuid,
  p_logical_id text,
  p_content_version integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT a.full_name INTO v_actor_name
  FROM public.admin_users a
  WHERE a.id = v_actor_id;
  IF v_actor_name IS NULL THEN
    RAISE EXCEPTION 'clinical_not_authorized';
  END IF;

  INSERT INTO public.activity_log (actor_id, actor_name, action, entity_type, entity_id, entity_label)
  VALUES (
    v_actor_id,
    v_actor_name,
    p_action,
    p_entity_type,
    p_revision_id::text,
    p_logical_id || '@v' || p_content_version::text
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app074_write_clinical_audit(text, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Admin reads never broaden the ordinary table policy. The return types are table-specific so
-- an external editorial client cannot turn these functions into an arbitrary-table endpoint.
CREATE OR REPLACE FUNCTION public.admin_list_health_condition_revisions()
RETURNS SETOF public.health_conditions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'clinical_not_authorized';
  END IF;
  RETURN QUERY SELECT h.* FROM public.health_conditions h ORDER BY h.id, h.content_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_symptom_glossary_revisions()
RETURNS SETOF public.symptom_glossary
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'clinical_not_authorized';
  END IF;
  RETURN QUERY SELECT s.* FROM public.symptom_glossary s ORDER BY s.id, s.content_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_health_condition_draft(
  p_id text, p_name_da text, p_name_en text, p_summary_da text, p_summary_en text,
  p_what_it_is_da text, p_what_it_is_en text, p_common_symptoms text[],
  p_what_helps_da text, p_what_helps_en text, p_when_to_see_doctor_da text,
  p_when_to_see_doctor_en text, p_source_reference text DEFAULT NULL,
  p_source_url text DEFAULT NULL, p_review_due_at date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_revision_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN
    RAISE EXCEPTION 'clinical_not_authorized';
  END IF;
  IF p_id IS NULL OR pg_catalog.btrim(p_id) = '' THEN RAISE EXCEPTION 'clinical_logical_id_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.health-condition:' || p_id, 0));
  IF EXISTS (SELECT 1 FROM public.health_conditions h WHERE h.id = p_id) THEN
    RAISE EXCEPTION 'clinical_logical_id_exists_use_next_revision';
  END IF;
  INSERT INTO public.health_conditions (
    id, content_version, status, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en,
    common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en,
    source_reference, source_url, review_due_at
  ) VALUES (
    p_id, 1, 'draft', p_name_da, p_name_en, p_summary_da, p_summary_en, p_what_it_is_da, p_what_it_is_en,
    COALESCE(p_common_symptoms, '{}'::text[]), p_what_helps_da, p_what_helps_en, p_when_to_see_doctor_da,
    p_when_to_see_doctor_en, p_source_reference, p_source_url, p_review_due_at
  ) RETURNING revision_id INTO v_revision_id;
  PERFORM public.app074_write_clinical_audit('created', 'health_condition', v_revision_id, p_id, 1);
  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_symptom_glossary_draft(
  p_id text, p_name_da text, p_name_en text, p_description_da text, p_description_en text,
  p_source_reference text DEFAULT NULL, p_source_url text DEFAULT NULL, p_review_due_at date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_revision_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN
    RAISE EXCEPTION 'clinical_not_authorized';
  END IF;
  IF p_id IS NULL OR pg_catalog.btrim(p_id) = '' THEN RAISE EXCEPTION 'clinical_logical_id_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.symptom-glossary:' || p_id, 0));
  IF EXISTS (SELECT 1 FROM public.symptom_glossary s WHERE s.id = p_id) THEN
    RAISE EXCEPTION 'clinical_logical_id_exists_use_next_revision';
  END IF;
  INSERT INTO public.symptom_glossary (id, content_version, status, name_da, name_en, description_da, description_en, source_reference, source_url, review_due_at)
  VALUES (p_id, 1, 'draft', p_name_da, p_name_en, p_description_da, p_description_en, p_source_reference, p_source_url, p_review_due_at)
  RETURNING revision_id INTO v_revision_id;
  PERFORM public.app074_write_clinical_audit('created', 'symptom_glossary', v_revision_id, p_id, 1);
  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_next_health_condition_revision(p_revision_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_source public.health_conditions%ROWTYPE; v_revision_id uuid; v_version integer;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  SELECT * INTO v_source FROM public.health_conditions WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_revision_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.health-condition:' || v_source.id, 0));
  SELECT pg_catalog.max(content_version) + 1 INTO v_version FROM public.health_conditions WHERE id = v_source.id;
  INSERT INTO public.health_conditions (
    id, content_version, status, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en,
    common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en, source_reference, source_url, review_due_at
  ) VALUES (
    v_source.id, v_version, 'draft', v_source.name_da, v_source.name_en, v_source.summary_da, v_source.summary_en,
    v_source.what_it_is_da, v_source.what_it_is_en, v_source.common_symptoms, v_source.what_helps_da, v_source.what_helps_en,
    v_source.when_to_see_doctor_da, v_source.when_to_see_doctor_en, v_source.source_reference, v_source.source_url, v_source.review_due_at
  ) RETURNING revision_id INTO v_revision_id;
  PERFORM public.app074_write_clinical_audit('revised', 'health_condition', v_revision_id, v_source.id, v_version);
  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_next_symptom_glossary_revision(p_revision_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_source public.symptom_glossary%ROWTYPE; v_revision_id uuid; v_version integer;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  SELECT * INTO v_source FROM public.symptom_glossary WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_revision_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.symptom-glossary:' || v_source.id, 0));
  SELECT pg_catalog.max(content_version) + 1 INTO v_version FROM public.symptom_glossary WHERE id = v_source.id;
  INSERT INTO public.symptom_glossary (id, content_version, status, name_da, name_en, description_da, description_en, source_reference, source_url, review_due_at)
  VALUES (v_source.id, v_version, 'draft', v_source.name_da, v_source.name_en, v_source.description_da, v_source.description_en,
          v_source.source_reference, v_source.source_url, v_source.review_due_at)
  RETURNING revision_id INTO v_revision_id;
  PERFORM public.app074_write_clinical_audit('revised', 'symptom_glossary', v_revision_id, v_source.id, v_version);
  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_health_condition_draft(
  p_revision_id uuid, p_name_da text, p_name_en text, p_summary_da text, p_summary_en text,
  p_what_it_is_da text, p_what_it_is_en text, p_common_symptoms text[],
  p_what_helps_da text, p_what_helps_en text, p_when_to_see_doctor_da text,
  p_when_to_see_doctor_en text, p_source_reference text, p_source_url text, p_review_due_at date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.health_conditions SET
    name_da = p_name_da, name_en = p_name_en, summary_da = p_summary_da, summary_en = p_summary_en,
    what_it_is_da = p_what_it_is_da, what_it_is_en = p_what_it_is_en, common_symptoms = COALESCE(p_common_symptoms, '{}'::text[]),
    what_helps_da = p_what_helps_da, what_helps_en = p_what_helps_en, when_to_see_doctor_da = p_when_to_see_doctor_da,
    when_to_see_doctor_en = p_when_to_see_doctor_en, source_reference = p_source_reference, source_url = p_source_url,
    review_due_at = p_review_due_at, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'draft'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_draft_not_found_or_immutable'; END IF;
  PERFORM public.app074_write_clinical_audit('updated', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_symptom_glossary_draft(
  p_revision_id uuid, p_name_da text, p_name_en text, p_description_da text, p_description_en text,
  p_source_reference text, p_source_url text, p_review_due_at date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.symptom_glossary SET name_da = p_name_da, name_en = p_name_en, description_da = p_description_da,
    description_en = p_description_en, source_reference = p_source_reference, source_url = p_source_url,
    review_due_at = p_review_due_at, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'draft'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_draft_not_found_or_immutable'; END IF;
  PERFORM public.app074_write_clinical_audit('updated', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_submit_health_condition_for_review(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.health_conditions SET status = 'in_review', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'draft' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_draft_not_found_or_immutable'; END IF;
  PERFORM public.app074_write_clinical_audit('submitted', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_submit_symptom_glossary_for_review(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.symptom_glossary SET status = 'in_review', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'draft' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_draft_not_found_or_immutable'; END IF;
  PERFORM public.app074_write_clinical_audit('submitted', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_health_condition_review(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.health_conditions SET reviewed_by = v_actor_id, reviewed_at = now(), updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'in_review' AND reviewed_by IS NULL AND reviewed_at IS NULL RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_review_not_pending'; END IF;
  PERFORM public.app074_write_clinical_audit('reviewed', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_symptom_glossary_review(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.symptom_glossary SET reviewed_by = v_actor_id, reviewed_at = now(), updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'in_review' AND reviewed_by IS NULL AND reviewed_at IS NULL RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_review_not_pending'; END IF;
  PERFORM public.app074_write_clinical_audit('reviewed', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_return_health_condition_to_draft(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.health_conditions SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'in_review' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_review_not_found'; END IF;
  PERFORM public.app074_write_clinical_audit('returned', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_return_symptom_glossary_to_draft(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role IN ('owner', 'editor')) THEN RAISE EXCEPTION 'clinical_not_authorized'; END IF;
  UPDATE public.symptom_glossary SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE revision_id = p_revision_id AND status = 'in_review' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_review_not_found'; END IF;
  PERFORM public.app074_write_clinical_audit('returned', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

-- Publication is intentionally distinct from review and owner-only. Locking one logical ID
-- serialises the replacement so the partial unique index never exposes two current revisions.
CREATE OR REPLACE FUNCTION public.admin_publish_health_condition(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE; v_old public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role = 'owner') THEN RAISE EXCEPTION 'clinical_owner_required'; END IF;
  SELECT * INTO v_row FROM public.health_conditions WHERE revision_id = p_revision_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'in_review' OR v_row.reviewed_by IS NULL OR v_row.reviewed_at IS NULL THEN RAISE EXCEPTION 'clinical_publication_requires_review'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.health-condition:' || v_row.id, 0));
  IF v_row.content_version <= 0 OR v_row.source_reference IS NULL OR pg_catalog.btrim(v_row.source_reference) = '' OR v_row.review_due_at IS NULL
     OR v_row.review_due_at < (now() AT TIME ZONE 'Europe/Copenhagen')::date
     OR pg_catalog.btrim(v_row.name_da) = '' OR pg_catalog.btrim(v_row.name_en) = ''
     OR pg_catalog.btrim(v_row.summary_da) = '' OR pg_catalog.btrim(v_row.summary_en) = ''
     OR pg_catalog.btrim(v_row.what_it_is_da) = '' OR pg_catalog.btrim(v_row.what_it_is_en) = ''
     OR pg_catalog.btrim(v_row.what_helps_da) = '' OR pg_catalog.btrim(v_row.what_helps_en) = ''
     OR pg_catalog.btrim(v_row.when_to_see_doctor_da) = '' OR pg_catalog.btrim(v_row.when_to_see_doctor_en) = '' THEN
    RAISE EXCEPTION 'clinical_publication_prerequisites_not_met';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_row.common_symptoms) AS symptom_id
    WHERE NOT EXISTS (SELECT 1 FROM public.symptom_glossary s WHERE s.id = symptom_id)
  ) THEN RAISE EXCEPTION 'clinical_unknown_symptom_logical_id'; END IF;
  SELECT * INTO v_old FROM public.health_conditions WHERE id = v_row.id AND status = 'published' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.health_conditions SET status = 'withdrawn', updated_at = now() WHERE revision_id = v_old.revision_id;
    PERFORM public.app074_write_clinical_audit('withdrawn', 'health_condition', v_old.revision_id, v_old.id, v_old.content_version);
  END IF;
  UPDATE public.health_conditions SET status = 'published', published_at = now(), updated_at = now() WHERE revision_id = v_row.revision_id;
  PERFORM public.app074_write_clinical_audit('published', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publish_symptom_glossary(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE; v_old public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role = 'owner') THEN RAISE EXCEPTION 'clinical_owner_required'; END IF;
  SELECT * INTO v_row FROM public.symptom_glossary WHERE revision_id = p_revision_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'in_review' OR v_row.reviewed_by IS NULL OR v_row.reviewed_at IS NULL THEN RAISE EXCEPTION 'clinical_publication_requires_review'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifesort.symptom-glossary:' || v_row.id, 0));
  IF v_row.content_version <= 0 OR v_row.source_reference IS NULL OR pg_catalog.btrim(v_row.source_reference) = '' OR v_row.review_due_at IS NULL
     OR v_row.review_due_at < (now() AT TIME ZONE 'Europe/Copenhagen')::date
     OR pg_catalog.btrim(v_row.name_da) = '' OR pg_catalog.btrim(v_row.name_en) = ''
     OR pg_catalog.btrim(v_row.description_da) = '' OR pg_catalog.btrim(v_row.description_en) = '' THEN
    RAISE EXCEPTION 'clinical_publication_prerequisites_not_met';
  END IF;
  SELECT * INTO v_old FROM public.symptom_glossary WHERE id = v_row.id AND status = 'published' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.symptom_glossary SET status = 'withdrawn', updated_at = now() WHERE revision_id = v_old.revision_id;
    PERFORM public.app074_write_clinical_audit('withdrawn', 'symptom_glossary', v_old.revision_id, v_old.id, v_old.content_version);
  END IF;
  UPDATE public.symptom_glossary SET status = 'published', published_at = now(), updated_at = now() WHERE revision_id = v_row.revision_id;
  PERFORM public.app074_write_clinical_audit('published', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_withdraw_health_condition(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.health_conditions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role = 'owner') THEN RAISE EXCEPTION 'clinical_owner_required'; END IF;
  UPDATE public.health_conditions SET status = 'withdrawn', updated_at = now() WHERE revision_id = p_revision_id AND status = 'published' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_published_revision_not_found'; END IF;
  PERFORM public.app074_write_clinical_audit('withdrawn', 'health_condition', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_withdraw_symptom_glossary(p_revision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_row public.symptom_glossary%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = v_actor_id AND a.role = 'owner') THEN RAISE EXCEPTION 'clinical_owner_required'; END IF;
  UPDATE public.symptom_glossary SET status = 'withdrawn', updated_at = now() WHERE revision_id = p_revision_id AND status = 'published' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinical_published_revision_not_found'; END IF;
  PERFORM public.app074_write_clinical_audit('withdrawn', 'symptom_glossary', v_row.revision_id, v_row.id, v_row.content_version);
END;
$$;

-- Explicit per-function grants make every definer RPC callable only from an authenticated
-- session; the body then applies the more restrictive owner/editor check.
REVOKE ALL ON FUNCTION public.admin_list_health_condition_revisions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_symptom_glossary_revisions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_health_condition_draft(text, text, text, text, text, text, text, text[], text, text, text, text, text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_symptom_glossary_draft(text, text, text, text, text, text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_next_health_condition_revision(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_next_symptom_glossary_revision(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_health_condition_draft(uuid, text, text, text, text, text, text, text[], text, text, text, text, text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_symptom_glossary_draft(uuid, text, text, text, text, text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_submit_health_condition_for_review(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_submit_symptom_glossary_for_review(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_approve_health_condition_review(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_approve_symptom_glossary_review(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_return_health_condition_to_draft(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_return_symptom_glossary_to_draft(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_publish_health_condition(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_publish_symptom_glossary(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_withdraw_health_condition(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_withdraw_symptom_glossary(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_health_condition_revisions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_symptom_glossary_revisions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_health_condition_draft(text, text, text, text, text, text, text, text[], text, text, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_symptom_glossary_draft(text, text, text, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_next_health_condition_revision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_next_symptom_glossary_revision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_health_condition_draft(uuid, text, text, text, text, text, text, text[], text, text, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_symptom_glossary_draft(uuid, text, text, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_submit_health_condition_for_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_submit_symptom_glossary_for_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_health_condition_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_symptom_glossary_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_return_health_condition_to_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_return_symptom_glossary_to_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_health_condition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_symptom_glossary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_health_condition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_symptom_glossary(uuid) TO authenticated;
