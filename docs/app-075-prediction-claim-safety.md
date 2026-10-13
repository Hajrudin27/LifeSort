# APP-075 — Prediction claim safety

**Story:** APP-075 · E8 Reproductive health integration · P0

**Master requirement:** Cycle predictions must be clearly probabilistic and must not be marketed as contraception or diagnosis.

APP-075 governs how LifeSort presents Cycle predictions. It does not change prediction formulas, create Pregnancy, or alter the APP-074 clinical-reference lifecycle.

## Product boundary

There are three distinct kinds of Cycle information:

- **Observed user data** — logged period starts, an open logged period, logged flow, and logged symptoms. These remain records, not estimates.
- **Calendar arithmetic** — for example, a cycle-day count from a logged start date. This remains factual arithmetic.
- **Predictions and inferred phases** — next period, countdowns, fertile window, ovulation, future phase, inferred current phase, Home helper text, Todo hints, and opt-in rich reminders. Each must be labelled as an estimate. Where a surface states the basis (the Cycle safety text, the calendar and wheel accessibility summaries, and the opt-in rich reminder), it names both logged cycles and current cycle settings. Compact surfaces (hero/status, Home, Todo) say only “estimated”/“estimate” and rely on the Cycle screen's safety text for the full basis, the can-be-inaccurate statement, and the not-contraception boundary. The generic lock-screen notification carries none of this and none of the Cycle detail.

With no logged period start, Cycle infers and shows no phase at all (the status reads "Not enough data"); the underlying `getCurrentPhase` helper still answers "follicular" for an empty history, so the Cycle screen gates on a logged start.

The Cycle calendar/wheel grouping displays this nearby safety text in both supported locales: estimates are based on logged cycles and current cycle settings, can be inaccurate, and must not be used as contraception. Logged periods remain visually and semantically distinct from calculated markers through both colour and visible marker shape; each marked day has an equivalent accessibility label.

If a calculated next period is before today's local date, presentation treats that prediction as stale: it shows “Estimate needs updating” (and the Danish equivalent), preserves observed logs and cycle-day arithmetic, and suppresses current inferred phase, countdown, fertile/ovulation guidance, and predicted calendar/wheel markers. A still-open logged period stays shown as logged (hero “Menstrual”, status “Active”) even when its calculated prediction is stale. A prediction dated today is current, not stale. This is a client presentation guard; it does not alter the prediction algorithm.

Cycle insights may describe associations in the user's own data and retain their non-medical-assessment disclaimer. They must not imply medical causality, diagnosis, normality/abnormality, or a patient-specific treatment recommendation.

## Claim-review checklist

Before either publishing Cycle clinical/reference content or approving external LifeSort Cycle marketing/store copy, the responsible editorial/release owner records that the proposed copy has been checked for all of the following:

- No contraceptive positioning, including language that represents estimated fertility, ovulation, or period timing as suitable for pregnancy prevention.
- No diagnostic positioning: no condition inference from a user's symptoms, no medical normal/abnormal label, and no personalized medical recommendation.
- Every reproductive prediction or inferred phase is clearly framed as an estimate based on logged cycles and current cycle settings.
- Danish and English have equivalent safety meaning; neither locale becomes more deterministic than the other.
- No personalized symptom escalation is added without a separate intended-purpose review.
- APP-074 remains responsible for source, reviewer, review-date, revision, and publication governance of clinical-reference content.

This is a product-copy checklist, not a clinical, legal, regulatory, or medical-device review. The external admin platform does not enforce it automatically.

## Marketing-review boundary

This repository contains no App Store or Play Store listing metadata, marketing screenshots, landing-page copy, or campaign asset set with Cycle claims. Its README contains no unsafe Cycle claim.

Review of the public website, store listings, screenshots, release copy, and campaign material is a **required final-launch dependency**. It is not complete until the responsible external release/marketing owner records this checklist against the actual material. APP-075 does not edit the separate website repository or fabricate that sign-off.

## Release and rollback

APP-075 changes client presentation and documentation only: there is no database migration, persisted-data change, consent change, SDK/vendor change, analytics change, or hosted Supabase action. A faulty copy release is corrected with a forward client hotfix or subsequent app release; no Cycle records or reminder preferences require migration or rollback.

Physical iPhone QA is **DEFERRED — samlet fysisk UI/device QA-sprint senere**, not passed. Before final v1 launch, verify VoiceOver, Dynamic Type, dark mode, contrast/readability, truncation, the Cycle calendar and wheel, Home snapshot, Todo hint, and rich notification copy.
