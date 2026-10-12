# APP-070 — Optional iOS contact picker for Gifts (P2)

**Story:** APP-070 · E7 Goals, habits, career & gifts · P2
**Acceptance:** "Just-in-time permission; selected/minimal fields; revoke/refresh handling."
**Decision record:** [ADR-0057](./adr/0057-gift-person-labels-may-be-copied-once-from-an-ios-contact-the-user-picks.md)
**Builds on:** [APP-069](./app-069-gift-planner.md) · [ADR-0056](./adr/0056-gifts-are-a-flat-device-local-list-that-joins-backups-through-an-injected-participant.md)

APP-070 adds one optional action to the Gift form: **Choose from Contacts**, which copies the first and last name of
one contact the user picks into the Person field. It is **iOS only**, asks for **no Contacts permission**, keeps
**no reference** to the contact, and merges with Gifts still **internal**.

## Platform support

| Platform | Contacts action | What the user does |
| --- | --- | --- |
| iOS | "Choose from Contacts" button under the Person field | Taps it, picks one person in the system picker; the name fills the field |
| Android | none: no button, no picker call, no permission | Types the Person label (as in APP-069) |
| Web | none | Types the Person label |

Android is deliberately **not** given parity. Doing so would plausibly need `READ_CONTACTS`, and APP-070 ships no
Contacts permission on Android at all (below). Manual entry remains the first-class way to enter a person everywhere,
including iOS: the Person field is the same text input it always was.

## User flow (iOS)

1. The user opens the new-Gift or edit-Gift form. **Nothing touches Contacts**: not opening Gifts, not mounting the
   form, not focusing a field. Only an explicit tap on the button calls the adapter.
2. The system's single-contact picker opens. No Contacts authorization prompt appears.
3. The user picks a contact, or cancels.
   - **Picked:** the name is placed in the Person field. Nothing is saved, no store is touched, no Gift is created or
     changed. The text is now ordinary form input the user can edit freely.
   - **Cancelled:** nothing changes and nothing is said.
   - **No usable name** (neither first nor last name): the field is unchanged and a neutral line says "This contact
     has no usable name. You can enter one manually."
   - **Unavailable / error:** the field is unchanged and a brief neutral line says the user can enter a name manually.
     No retry loop, no Settings redirect, no prompt.
4. **Save** is the normal Save. The usual `personLabel` rules run then: trimmed, required, 1–100 UTF-16 units, one
   line, no control characters. A picked name is never truncated; one that fails shows the ordinary field error and
   the user can edit it.

The same `GiftForm` serves new and edit, so both behave identically. Selecting a name alone never changes a saved
Gift; leaving the form without Save leaves the stored Gift exactly as it was.

## The adapter and exactly what it reads

`features/gifts/contacts/pickContactName.ts` is the only file that loads `expo-contacts`, and it loads
`expo-contacts/legacy` lazily, inside the call, only on iOS. Its one native call is
`presentContactPickerAsync()`.

```ts
type PickContactNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'no_name' | 'error' };
```

**Name building.** Only `firstName` and `lastName`. Each must be a string; each is trimmed; blanks are dropped; the
remainder are joined with one space and trimmed. Neither present → `no_name`. `middleName`, `namePrefix`,
`nameSuffix` and `nickname` are not used (they were not verified and are not needed; the user can edit the field).
The id, phone numbers, emails, birthday, company, image, contact type, addresses, notes, organisation and
relationships are **never read** and are **never a fallback**.

**Lifetime.** The raw object exists only inside one adapter call. It is not put in Zustand, navigation params,
storage, backup, component state, context, logs, analytics, errors or Supabase. A native error's message is never
read or returned, because it could carry an identifier; errors are normalised to a fixed code.

## The privacy trade-off, stated plainly

The legacy Expo bridge hands JavaScript the **whole selected contact** for the duration of the call; it cannot be
asked for the name alone. LifeSort therefore does **not** claim to "receive only the name". The accurate statement is:

> LifeSort uses only the first and last name from the contact you select and does not store the contact record.

This is accepted because the alternatives are worse for the user: the new iOS API ends in a Contacts authorization
prompt (and a sticky denial) just to read a name, and Android parity needs a standing permission. The adapter's tests
prove that nothing but `firstName` and `lastName` is read and that nothing else is returned. The legacy API is
**deprecated** in Expo SDK 57; that is accepted and contained behind the adapter.

## No permission request, at all

APP-070 never calls `requestPermissionsAsync`, `getPermissionsAsync`, `Contact.get*`, `Contact.presentPicker`,
`Contact.presentAccessPicker` or `ContactAccessButton`. It never enumerates or searches the address book
(`getContactsAsync`, `getAll*`, counts, groups, containers) and never writes to it. There is no permission-state
cache, no listener and no Contacts-change subscription. The system picker is the selection mechanism.

## Android and the generated manifest

The `expo-contacts` config plugin adds **both** `android.permission.READ_CONTACTS` and
`android.permission.WRITE_CONTACTS` to the Android manifest. `app.json` therefore blocks both with
`android.blockedPermissions`, which Expo turns into `tools:node="remove"` entries. A config test fails if either block
is removed. A disposable prebuild (outside the repository; nothing generated is committed) confirmed that the
generated source `AndroidManifest.xml` removes both. **A merged APK manifest has not been inspected** (no Android SDK
or device is available here); that is manual QA. No Google Play Contacts Permissions declaration is needed for this
story.

## iOS configuration

The plugin carries the Danish purpose string: "LifeSort bruger kun dine kontakter, når du vælger en person til en
gave." Even though no authorization is requested, the binary contains the native module and App Store validation may
require `NSContactsUsageDescription`. The disposable prebuild confirmed the string lands in the generated `Info.plist`.
App Store privacy and Google Data Safety forms are **not** claimed complete here: no contact data leaves the device,
one selected contact is used, the raw object is transient and only `personLabel` persists. Verifying store disclosures
is a release/activation task.

## Revoke, refresh, rename, delete

| Situation | Behaviour |
| --- | --- |
| Contacts authorization revoked or denied | Irrelevant to saved Gifts and to the picker: the legacy picker does not rely on standing authorization. If the picker is ever unavailable, manual entry remains. This is the approved reading of "revoke handling". |
| Refresh | No background refresh, listener or AppState hook. Tapping "Choose from Contacts" again in a form is the explicit refresh. This is the approved reading of "refresh handling". |
| Contact renamed on the device | Saved Gifts do not change. Re-pick to take the new name. |
| Contact deleted on the device | Saved Gifts do not change. No reference exists to dangle. |
| Backup restored | Needs no Contacts capability; it carries only `personLabel`. |

## What did not change

- **Schema:** `Gift` is still exactly `id, personLabel, idea, occasionLabel?, occasionDate?, budget?, purchasedOn?,
  paid?, createdAt`. No contact id, source flag, phone, email, avatar, birthday, organisation, address or
  relationship. The strict decoder still refuses any such key.
- **Storage:** Profile A, `gifts.gifts`, `async-storage:lifesort-gifts`, `expectsServerSync: false`. No new store, key,
  migration, logout entry, Contact cache or permission-state cache.
- **Backup:** `BACKUP_VERSION` stays **14**. No code change; an exported Gift has its nine keys.
- **Server:** no Supabase, migration, table, RLS, grant, RPC, outbox or recipient service. `supabase/` is unchanged.
- **Logging and analytics:** none. No copied name or contact data reaches the console, a logger or an event.
- **Availability:** Gifts is still `internal`.

## Native build impact

APP-070 changes native dependencies and config: a new `expo-contacts` dependency, an `NSContactsUsageDescription`
entry and Android blocked permissions. **A new iOS/native binary and dev client are required**; an older dev-client
binary without the module makes the button report "unavailable" instead of crashing the Gifts route. The existing
database Staging and Production workflows do **not** deploy client code and are expected to remain no-op database gates
after this change is committed and pushed.

## Where it lives

| Concern | File |
| --- | --- |
| The adapter | [`features/gifts/contacts/pickContactName.ts`](../features/gifts/contacts/pickContactName.ts) |
| The form action | [`components/GiftForm.tsx`](../components/GiftForm.tsx) |
| Copy | `localization/locales/{en,da}/gifts.json` (`chooseContact`, `contactHelp`, `contactNotice.*`) |
| Native config | `app.json` (`expo-contacts` plugin; `android.blockedPermissions`) |

## Verification

Automated: the adapter (`giftContactPicker`: platform gate, outcomes, name building, ignored fields, call-surface and
logging), the form (`giftContactsUi`: iOS, Android and web; new and edit; no auto-save; EN/DA), the native config
(`contactsConfig`: dependency, plugin, purpose string, both Android blocks, Gifts still internal), the unchanged shapes
(`giftContactsScope`: backup 14, nine keys, storage, server), the dependency and scope guards (`giftDomainBoundary`,
replaced rather than removed by this story) and the SDK inventory (`dataSdkInventory`).

## Manual QA still required

Not claimed by the automated tests:

**iOS physical device (on a new native build):**
- the picker opens, and **no Contacts authorization prompt appears**;
- picking a contact with first and last name, first name only, last name only, no name, and a Unicode name;
- cancel; behaviour with Contacts authorization already denied or revoked in Settings;
- the edit-Gift form; VoiceOver on the button and the notices; the largest Dynamic Type; dark mode;
- the purpose string and the App Store build/validation behaviour.

**Android:** manual Gift entry; no Contacts button; the **merged APK manifest** contains neither an active
`READ_CONTACTS` nor `WRITE_CONTACTS`.

**Web:** manual Gift entry; no Contacts button.

**Native rebuild / dev client:** pending.

## Before Gifts is activated

Everything under Manual QA; the App Store privacy label and Google Data Safety review for the contact selection; the
Privacy Center (APP-096), which remains an activation/release gate rather than a merge blocker; and the existing APP-069
activation checks. APP-104 (a shared permission framework) is separate: APP-070 requests no permission.
