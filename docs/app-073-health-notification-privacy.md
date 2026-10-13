# APP-073: Health notification privacy

Cycle reminders use the stable local-notification identifier `cycle-period-reminder`. Before APP-073, the scheduled
title and body named an expected period and the prediction history. APP-073 cancels that identifier after the encrypted
Cycle store has hydrated on the first start of updated code, then schedules only generic copy unless the user has
explicitly enabled rich lock-screen copy.

The default EN text is “LifeSort reminder” / “You have a reminder in LifeSort.” The DA equivalent is “Påmindelse fra
LifeSort” / “Du har en påmindelse i LifeSort.” Neither path carries a notification data payload. Rich copy is available
only behind the explicit `richNotificationCopyEnabled` preference, which is **device-local**: it is held in the encrypted
Profile-B `lifesort-cycle` store, is never sent to or read from Supabase, and is reset by the existing logout/account
cleanup. A fresh device, reinstall, legacy payload or new login starts false, and opting in on one device never enables
it on another. Only the strict value `true` counts; any other value is generic. APP-073 makes no database, RLS or grant
change, and reminder timing preferences keep their existing cloud behavior.

The startup refresh never prompts for notification permission. It cancels offline and schedules only when the existing
permission already permits it. Scheduling additionally requires a current owning account, explicit Cycle enablement,
reminders enabled, and a future valid prediction. Disabling Cycle cancels the request; re-enabling retains the user's
reminder and rich-copy choices.

## Why device-local

Showing reproductive-health detail on a lock screen is a device privacy choice, so it is not synchronized. This also
keeps a stale cloud value from undoing a local opt-out. APP-079 may revisit notification settings but must not weaken
this per-device rule.

## Concurrency

Refreshes run in one serialized lane and each task re-checks the live account before and after every native await
(cancel, permission read, schedule), cancelling its own schedule if the account went stale. Logout's global cancellation
is unchanged. A transient older request can exist until the newer queued refresh replaces it.

## Rollout limit

JavaScript cannot rewrite an OS-scheduled request before the updated app first executes. A legacy reminder can therefore
still fire before that first launch. APP-073 sanitizes it at the first launch afterwards; background execution, service
extensions, push, and central notification infrastructure remain out of scope.

## Deferred work

APP-076 Pregnancy, APP-079 notification permission/categories, APP-080 timezone/DST scheduling, APP-082 action routing,
APP-083 quiet hours, and APP-084 push remain separate work.
