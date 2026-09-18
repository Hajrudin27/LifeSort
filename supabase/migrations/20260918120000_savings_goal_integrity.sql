-- APP-043: savings goal integrity for every NEW write.
-- Forward-only. Written and verified against a scratch PostgreSQL cluster
-- (tests/db/app043.test.cjs); NOT applied to any remote project.
-- No RLS policy, grant, function or column change: two CHECKs, one foreign key
-- and the index that foreign key needs.
--
-- WHY NOT VALID. Every constraint below is added NOT VALID: PostgreSQL enforces it
-- for every INSERT and UPDATE from now on, but does not re-check rows that already
-- exist. That is deliberate, because this repository cannot prove what production
-- holds:
--  - Orphan history rows can exist from legitimate app behaviour. The client
--    deletes a goal and then its history in two separate requests; if the second
--    fails, history outlives its goal. Deleting those rows would guess the user's
--    intent, so they are left exactly as they are.
--  - Every shipped build required target > 0 in its forms and clamped balances at
--    zero, so legitimate rows should satisfy both CHECKs. Rows written by other
--    means (direct API calls, restored hand-edited backups) cannot be ruled out,
--    and a validating ADD CONSTRAINT would then fail the whole migration.
-- Nothing is rewritten, repaired or deleted here. Validating the constraints later
-- (ALTER TABLE ... VALIDATE CONSTRAINT) is a separate, explicit step after a
-- read-only audit of production shows no violating rows; see
-- docs/app-043-savings-goals.md for the audit queries.

-- 1. A target is a positive, finite amount. `< 'Infinity'` also excludes NaN,
-- which PostgreSQL orders above every number (so NaN > 0 would otherwise pass).
-- Dropping first keeps this migration re-runnable.
alter table public.savings_goals
  drop constraint if exists savings_goals_target_amount_positive;
alter table public.savings_goals
  add constraint savings_goals_target_amount_positive
  check (target_amount > 0 and target_amount < 'Infinity'::numeric) not valid;

-- 2. A goal's current balance is never negative. There is deliberately NO upper
-- bound: saving more than the target (overfunding) is valid. There is also no
-- saved_amount = sum(history) rule: the client writes the goal row and its history
-- rows in separate requests, and historical rows need not satisfy it.
alter table public.savings_goals
  drop constraint if exists savings_goals_saved_amount_non_negative;
alter table public.savings_goals
  add constraint savings_goals_saved_amount_non_negative
  check (saved_amount >= 0 and saved_amount < 'Infinity'::numeric) not valid;

-- 3. A history row belongs to an existing goal of the SAME account. The key
-- includes user_id, so one account's history can never point at another
-- account's goal, even when their text IDs are equal. ON DELETE CASCADE matches
-- what the app already does: deleting a goal deletes its history, now in the
-- same statement instead of a second request that can fail on its own.
-- Referential checks bypass RLS by design; because user_id is part of the key,
-- they only ever look at the caller's own goals.
create index if not exists savings_history_user_id_goal_id_idx
  on public.savings_history (user_id, goal_id);
alter table public.savings_history
  drop constraint if exists savings_history_goal_fkey;
alter table public.savings_history
  add constraint savings_history_goal_fkey
  foreign key (user_id, goal_id) references public.savings_goals (user_id, id)
  on delete cascade not valid;

comment on constraint savings_goals_target_amount_positive on public.savings_goals is
  'APP-043: target_amount is a positive finite DKK amount. NOT VALID: enforced for new writes; existing rows not yet validated.';
comment on constraint savings_goals_saved_amount_non_negative on public.savings_goals is
  'APP-043: saved_amount is never negative; overfunding is allowed. NOT VALID: enforced for new writes; existing rows not yet validated.';
comment on constraint savings_history_goal_fkey on public.savings_history is
  'APP-043: history belongs to an existing goal of the same account; deleting the goal deletes its history. NOT VALID: existing orphan rows are preserved, not guessed at.';
