/**
 * Offentlige adresser, appen og butikkerne skal være enige om (APP-023).
 *
 * Ét sted. Står den samme adresse både i appen, i Play Console og på
 * hjemmesiden, skal den kunne rettes ét sted — ellers driver de fra hinanden,
 * og den, der opdager det, er en anmelder hos Google.
 */

/** Domænet for LifeSorts offentlige sider. */
export const PUBLIC_SITE_ORIGIN = 'https://lifesort.dk';

/**
 * Sletning af konto uden appen.
 *
 * Google Play kræver, at en bruger kan bede om at få sin konto slettet fra en
 * webadresse — også efter at have afinstalleret appen. Adressen skal både stå i
 * Play Console under "Data deletion" og være tilgængelig uden login til noget
 * som helst andet end kontoen selv.
 *
 * Siden ligger i web/account-deletion/ og skal udgives på adressen her. Se
 * docs/account-deletion.md.
 */
export const ACCOUNT_DELETION_URL = `${PUBLIC_SITE_ORIGIN}/delete-account`;

/** Privatlivspolitikken. Skal være live før første indsendelse (APP-162). */
export const PRIVACY_POLICY_URL = `${PUBLIC_SITE_ORIGIN}/privatliv`;
