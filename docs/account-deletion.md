# LifeSort — Account Deletion

**Story:** APP-022 (E2 · Auth, onboarding & account, P0)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/auth/deleteAccount.ts`](../core/auth/deleteAccount.ts), [`app/settings/delete-account.tsx`](../app/settings/delete-account.tsx)
**Enforced by:** `__tests__/deleteAccount.test.ts`

## What the user does

Settings → Delete account. Two confirmations are required, and they guard
different things:

- **Typing your own email address**, so a mis-tap cannot do it.
- **Your password**, re-checked against the server, so an unlocked phone left on
  a table cannot do it either.

Then the screen reports each stage as it happens rather than showing a spinner
while an account is being destroyed.

## The order, and why it cannot change

1. **Files** — Storage objects, read from the `attachments` table rather than by
   listing the bucket, because the files sit in nested paths and the table knows
   exactly where.
2. **Account** — `delete_my_account`, which cascades every user table from
   `auth.users`. One call rather than a list of tables that would go stale the
   next time a table is added.
3. **This device** — local stores, files, notifications and keys, via the same
   sweep as logout (ADR-0017).

Files **must** go first: the Storage policy only lets a user delete their own
files, and "their own" is defined by a user who is about to stop existing.
Reversing the order would fail silently and leave someone's receipts in the
cloud after their account was gone.

The cost of that order is real and is surfaced: if step 2 fails, the files are
already deleted. The screen says so plainly instead of letting the user discover
it later.

## Failure behaviour

| Situation | What happens |
| --- | --- |
| Not signed in | Nothing is touched |
| Account deletion fails | Local data is **kept** — the account still exists, so wiping the phone would take data the user still owns |
| Sign-out fails after deletion | Local data is cleared anyway — the account is gone, and a deleted user's data must not stay on the phone |
| An admin account | Refused, with a message that says why |

Each of these is a test, because each is a way to get deletion wrong that looks
fine in the happy path.

## What is deleted, and what lingers

The screen tells the user both, because a deletion screen that does not say is
asking for trust it has not earned:

- **Deleted:** the account and everything in it — expenses, savings, trips,
  warranties, tasks, habits, goals, career and cycle — plus every uploaded file.
- **Lingers briefly:** the database provider's backups, which roll over on their
  own schedule and are not used for anything.

There are no third-party providers yet — no bank connection, no AI vendor — so
there is no provider-derived data to delete. That changes with the Open Banking
and AI work, and this list must change with it.

## Deleting without the app (APP-023)

Google Play requires a **web address** where someone can delete their account
without installing the app — including after uninstalling it. Apple requires the
in-app path; Google requires both.

**The page:** [`web/account-deletion/index.html`](../web/account-deletion/index.html),
a single self-contained file with no build step and no dependency beyond the
Supabase client.

**Identity is proved by password**, not by typing an address. If an email
address alone were enough, the page would be a weapon rather than a right. The
address is typed twice as well, but that only guards against a mis-tap — the
password is what proves anything.

It calls the **same** `delete_my_account` as the app, so the two can never end
up deleting different things, and it gives the same answer for a wrong password
as for an unknown account (ADR-0014).

There is no analytics on it. Someone reaching this page is leaving; measuring
that would be the wrong instinct.

### Deploying it

1. Copy `web/account-deletion/index.html` to the public site at the path in
   `ACCOUNT_DELETION_URL`.
2. Replace `__SUPABASE_URL__` and `__SUPABASE_PUBLISHABLE_KEY__` with the
   project's values. Both are public and already ship inside the app bundle.
   The **service key must never appear here** — a test asserts the file
   contains no key at all.
3. Confirm the page loads over HTTPS and is reachable without signing in to
   anything else.

### Play Console

Under **App content → Data safety → Data deletion**, give the same URL that
`core/config/publicUrls.ts` holds. The app links to that constant too, so the
two cannot drift.

> **The domain is an assumption.** `PUBLIC_SITE_ORIGIN` is set to
> `https://lifesort.dk`. Confirm it before the first store submission — a URL
> that does not resolve fails Play review.

## What is not verified here

`delete_my_account` lives in the Supabase project and is **not** version
controlled in this repository (`docs/app-inventory.md` §8-F10). The client
tests prove the app calls it in the right order and handles every answer; they
cannot prove the function deletes what it should.

Bringing it, the cascade constraints and the orphaned-file sweep under
migration control is APP-141, and verifying them is what pgTAP is for
(APP-106). Until then the server half of this flow is reviewed by reading the
project, not by CI.
