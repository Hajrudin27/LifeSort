# ADR-0057: Gift person labels may be copied once from an iOS contact the user picks

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-12 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-070 |
| **Superseded by** | – |

## Context

APP-070 asks for optional, selective Contacts import for Gifts: "Just-in-time permission; selected/minimal
fields; revoke/refresh handling." APP-069 (ADR-0056) shipped Gifts with a typed person label and no Contacts
integration, and left Contacts to APP-070. The master specification (§8.9) says to avoid requiring Contacts for v1
and, if it comes later, to request permission just in time and allow manual entry.

An iOS spike (S0) against Expo SDK 57 (`expo-contacts` 57.0.x) established the platform facts this decision
rests on:

- **The new API picker opens without permission, but reading the selected contact's name triggers a Contacts
  authorization request.** If the user denies it, the denial is sticky and the accessor then fails. A picker that
  ends in a permission prompt, and in a dead end after one "no", is the opposite of "selected/minimal".
- **The legacy picker (`expo-contacts/legacy`, `presentContactPickerAsync()`) opens the system's single-contact
  picker, shows no Contacts authorization prompt, leaves the permission state undetermined, and returns the one
  chosen contact directly.** It kept working after Contacts authorization had been denied or revoked.
- **The legacy bridge returns more than a name.** The returned object may carry `id`, names, `contactType`,
  `imageAvailable`, `phoneNumbers`, `emails`, `birthday`, `company` and other fields.
- **No permission-free Android selection path has been verified.** There is no Android SDK or device in this
  environment, and source-code reading is not production behaviour. Parity would plausibly mean shipping
  `READ_CONTACTS` for a convenience, which the specification's minimal-permission stance argues against.
- **The `expo-contacts` config plugin adds both `READ_CONTACTS` and `WRITE_CONTACTS` to the Android manifest**,
  whatever the app then does with them.

## Decision

1. **Platform-scoped scope.** APP-070 v1 is an **iOS-only** optional action: pick one contact in the system
   picker and copy its name into the Gift form. **Android and web stay manual-entry only**: no button, no picker
   call, no permission. Manual entry stays first-class everywhere, including on iOS.
2. **Legacy picker, isolated.** The adapter calls `expo-contacts/legacy` `presentContactPickerAsync()`. The new
   `Contact.presentPicker()` path is rejected (first bullet above). The legacy API is **deprecated** in SDK 57; the
   deprecation is accepted, and contained by putting the one call behind a feature-local adapter
   (`features/gifts/contacts/pickContactName.ts`) so a replacement is a one-file change. The package is loaded
   lazily inside the call, only on iOS, so Gifts renders without it and an older dev client fails in one contained
   operation rather than at the route.
3. **No Contacts authorization is ever requested, read or cached.** LifeSort calls none of
   `requestPermissionsAsync`, `getPermissionsAsync`, `Contact.get*`, `Contact.presentPicker`,
   `Contact.presentAccessPicker` or `ContactAccessButton`. The system picker is the selection mechanism and
   the user's explicit tap is the only trigger. There is no "just-in-time permission prompt" because there is no
   prompt.
4. **One contact, selection only.** The only read path is the single-contact picker. No enumeration or search
   (`getContactsAsync`, `getAll*`, counts, groups, containers) and no writes (create, update, delete, group
   mutation) exist anywhere in the repository.
5. **The adapter reduces a contact to one string.** The legacy bridge transiently exposes more fields than a name;
   the adapter reads **only `firstName` and `lastName`**, each trimmed, blanks dropped, joined by one space. It never
   reads the id, phone numbers, emails, birthday, company, image, contact type, addresses, notes, nickname,
   middle name, prefix, suffix or relationships, and never uses any of them as a fallback. A contact with neither
   name gives `no_name`. Its result is `{ ok: true, name }` or `{ ok: false, reason }` with `reason` one of
   `cancelled`, `unavailable`, `no_name`, `error`. No contact object, and no native error message, leaves the
   adapter. The raw object lives for the length of one call and is never put in state, navigation params, storage,
   backup, logs, analytics, the server or an error.
6. **One-way copy into the existing label.** The name becomes the Person field's text. Nothing is saved by
   picking; the text is ordinary, editable form input, checked by the normal Gift rules (trimmed, 1–100 UTF-16 units,
   single line, no control characters) **only when the user presses Save**. An imported name is never truncated:
   one that fails shows the ordinary field error.
7. **No schema, storage, backup or server change.** `Gift` stays exactly its nine keys. No contact id, source flag,
   phone, email, avatar, birthday, organisation, address or relationship is added. No `lifesort-*` key, store,
   migration or logout entry is added. **Backup stays format 14.** Gifts stays Profile A, `expectsServerSync: false`.
   `supabase/` is unchanged. Device contact data never reaches a server.
8. **No live relationship, so the lifecycle questions answer themselves.**
   - *Rename or delete in Contacts:* saved Gifts do not change and nothing dangles; the saved value is a plain string.
   - *Revoke:* iOS does not rely on standing Contacts authorization here, so existing Gifts are independent of
     permission state; if the picker is ever unavailable, manual entry remains. This is the approved reading of
     "revoke handling".
   - *Refresh:* there is no background refresh, listener or subscription. Tapping "Choose from Contacts" again is
     the explicit refresh. This is the approved reading of "refresh handling".
9. **Android cannot request Contacts at all.** `app.json` blocks **both** `android.permission.READ_CONTACTS` and
   `android.permission.WRITE_CONTACTS` through `android.blockedPermissions`, overriding the plugin. No Play
   Contacts permission declaration is therefore needed for this story.
10. **The iOS purpose string is declared and factual.** The plugin carries `contactsPermission`: "LifeSort bruger
    kun dine kontakter, når du vælger en person til en gave." No request is made, but the binary contains the native
    module and store validation may require the description.
11. **Gifts stays internal.** `availability` is not changed. A new native iOS binary and dev client are required;
    the database deployment workflows do not ship client code.

## Consequences

- iOS users get a convenient way to avoid retyping a name, with no permission prompt and no standing access.
  Android and web users type the name, as in APP-069.
- LifeSort cannot honestly say it "only receives the name": the legacy Expo bridge returns a whole contact object to
  JavaScript for the duration of the call. The accurate statement is: *LifeSort uses only the first and last name
  from the contact you select and does not store the contact record.* The limitation is documented, and the adapter's
  tests prove that nothing else is read or returned.
- The legacy API is deprecated. If a later SDK removes it, the picker disappears from iOS (the adapter returns
  `unavailable` through its containment) and Gifts keeps working manually until a replacement is chosen. A
  replacement must pass the same review: no standing authorization, one contact, a name only.
- A native rebuild is needed (new native dependency and plist entry). An old dev-client binary without the module
  makes the button report "unavailable" rather than crash.
- The APP-069 guard in `__tests__/giftDomainBoundary.test.ts` that banned any Contacts reference was replaced,
  not removed. It now proves that only the adapter loads `expo-contacts`, that the Gift type, core format, domain,
  store and screens have no Contact concept, that the form receives only the normalised result, and that no
  enumeration, write, permission or logging API exists.
- Apple App Privacy and Google Data Safety answers are not claimed complete by this change. No contact data leaves the
  device, one selected contact is used, the raw object is transient and only `personLabel` persists; verifying the
  store disclosures remains a release/activation task.
- A merged Android manifest from a real build has not been inspected: only the generated source manifest was
  (disposable prebuild). It is manual QA before activation.

*Amended after APP-070 physical QA / ADR-0058: the iOS picker was verified on a physical iPhone. ADR-0058 then made
LifeSort v1 iOS-first, so the merged Android manifest check and Android device QA above are **DEFERRED — outside v1
release scope**, to the future Android release track. They were not run and are **not** a PASS. They no longer block
APP-070 from closing for the current iOS v1 scope. The Apple App Store privacy and purpose-string review remains a
release/compliance gate. This amendment does not supersede the decision: the Contacts architecture stands.*

## Alternatives considered

- **Android import through `READ_CONTACTS`.** Rejected: a broad, runtime-prompted permission for a typed name, and an
  unnecessary Play review surface. Android stays manual.
- **The new iOS API (`Contact.presentPicker()`).** Rejected: reading the selected name triggers authorization, and a
  denial is sticky.
- **Requesting Contacts permission, then enumerating or searching.** Rejected: it is the "full contact import" the
  specification says not to default-enable, and it is not needed to pick one person.
- **A `contactId` on Gift so a name could be refreshed.** Rejected: an identifier is a live relationship that must
  then survive rename, delete, revoke, restore and a new phone. The user re-picks instead.
- **Using the phone, email or company when there is no name.** Rejected: that would turn another person's contact data
  into a label the user did not choose.
- **A shared platform permissions framework.** Rejected: one consumer and no permission to request. APP-104 owns
  broader permission work.
- **Waiting for a non-deprecated permission-free picker.** Rejected: there is none today, and the adapter is the seam
  that makes a later swap cheap.
