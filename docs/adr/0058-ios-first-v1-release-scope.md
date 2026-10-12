# ADR-0058: LifeSort v1 is iOS-first and Android is deferred

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-12 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | Project-wide release policy |
| **Superseded by** | – |

## Context

LifeSort is an Expo / React Native app with shared iOS and Android code paths. Until now nothing said which native
platform a story had to be verified on before it counted as finished, so audits treated every missing Android
check (a merged manifest, a physical Android device, a Play Store disclosure) as an open blocker, next to the iOS
work that actually gates a first release.

APP-070 made this concrete. Its iPhone behaviour was verified on a physical device. Its Android item (inspect the
merged APK manifest and run manual-entry QA on a device) was never run, because there is no Android release target
at the moment, and it stayed listed as unresolved.

The product and release decision is now explicit: **v1 / MVP launches on iPhone, through the Apple App Store,
first.** Android is not abandoned. It moves to a later, dedicated release track.

## Decision

1. **LifeSort v1 is iOS-first.** The supported MVP/v1 release target is iPhone through the Apple App Store.
2. **Android is deferred, not abandoned.** Android stays part of the shared Expo / React Native architecture where
   practical. Android-specific feature completion, native builds, physical-device QA, Play Store work and
   Android-only release gates belong to a future Android release track.
3. **Android does not block ordinary v1 stories.** A story is complete for the current iOS release when the shared
   logic is correct, the automated tests are green, the required iOS implementation is done, and the required iOS
   physical/native QA is done, even if no Android-specific physical QA or store verification has been run.
4. **Deferred Android work is labelled honestly.** It is recorded as **DEFERRED — outside v1 release scope**. An
   Android check that was not performed is never reported as PASS.
5. **Shared architecture stays portable.** Shared domain logic, storage semantics, sync logic, security and privacy
   contracts and business rules are not moved into iOS-only implementations without a reason. Platform-specific
   native behaviour stays behind explicit platform boundaries and adapters where that is appropriate (the APP-070
   contact adapter is the model).
6. **Deferral is not permission to break shared code.** TypeScript correctness, the shared tests, the common
   contracts, safe configuration and the shared privacy and security invariants are still required, as is
   reasonable build portability where that is practical.
7. **iOS native changes still need real iOS verification.** When a story changes a native dependency, an entitlement,
   a permission-sensitive feature, a platform API or native configuration, the iOS binary is rebuilt and physically
   verified whenever the story depends on device behaviour.
8. **Apple release and compliance is the active native release track.** Its gates include App Store privacy
   disclosures, purpose strings, signing and build validation, accessibility, physical iPhone QA and the other
   Apple-specific requirements.
9. **Android release work moves to a future explicit track.** Before claiming Android support or shipping on Google
   Play, Android readiness is reopened and the deferred work that is relevant at that time is done, including native
   Android build verification, physical Android device QA, manifest and permission verification, Play Store
   disclosures and Android-specific regression checks.
10. **The database release gates are unchanged.** CI, then the Staging database, then the Production database still run
    as they do today. These workflows validate shared and server state. They do not deploy the mobile client.
11. **APP-070 closes under the iOS v1 scope.** Its iOS contact picker and device behaviour were verified on a
    physical iPhone. Its Android merged-manifest and device verification is **DEFERRED — outside v1 release scope**,
    not PASS, and no longer an open blocker for APP-070. See the amendment to ADR-0057.

## Consequences

- Release effort can concentrate on one native platform, with one set of devices, builds and store requirements.
- Native stories no longer wait for Android hardware or Play Store work while Android is not an active target.
- The deferred Android work stays visible as DEFERRED, not hidden and not claimed. It is a backlog for the future
  Android track, and it is owed in full.
- iOS features may ship before Android has parity. Some stories are iOS-only by design (APP-070), and others will
  simply be unverified on Android.
- The Expo / React Native portability is intentional and has to be kept up. Shared code that quietly becomes
  iOS-only makes the later Android pass more expensive.
- A dedicated Android readiness pass will be required before any Android claim or Play Store submission. The
  existing Android configuration (for example the Contacts permission blocks in `app.json`) stays in place, but is
  not verified on a device.
- Existing ADRs remain historical records. Where one lists Android verification as pending, a dated amendment
  points here instead of rewriting it.

## Alternatives considered

- **A. Equal iOS and Android v1 release targets.** Rejected: the Android release overhead (devices, builds, manifests,
  Play Store forms) would block an Apple-only first release without improving iOS quality.
- **B. Remove Android support from the codebase.** Rejected: the shared Expo / React Native architecture already gives
  a viable later Android path, and removing it would be work that has to be undone.
- **C. Ignore Android without documenting the policy.** Rejected: audits would keep treating the missing Android
  checks as unresolved blockers, or worse, someone would read an unrun check as a pass.
- **D. Rewrite LifeSort as native iOS-only.** Rejected: there is no product reason to throw away the existing shared
  architecture.
