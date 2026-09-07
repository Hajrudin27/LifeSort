#!/usr/bin/env node
/**
 * APP-007 — "ændringer i storage/sync/auth kræver en ADR".
 *
 * Kører mod en diff: rører ændringen et af de styrede områder, uden at der
 * samtidig er skrevet eller rettet en ADR, fejler den.
 *
 *   npm run check:adr            # sammenlign med main
 *   npm run check:adr -- <ref>   # sammenlign med en anden ref
 *
 * Ingen CI kører den endnu (APP-139/APP-141 sætter det op). Indtil da er den
 * noget man kalder selv eller hænger på en pre-push hook. Reglen står i
 * docs/adr/README.md, og listen herunder er det ene sted den findes — testen
 * importerer den herfra frem for at gentage den.
 */

const { execFileSync } = require('node:child_process');

/**
 * De områder hvor en beslutning er dyr at gøre om: hvordan data ligger, hvordan
 * de synkroniseres, og hvordan brugeren bevises at være sig selv. Præcis her er
 * det billigt at genindføre et gammelt mønster ved et uheld — se ADR-0006, hvor
 * det rigtige valg er én linje længere end det forkerte.
 *
 * Mønstre der ender på '/' matches som stipræfiks; resten som nøjagtig fil.
 */
const ADR_GOVERNED_PATHS = [
  // storage
  'store/',
  'core/storage/',
  'utils/shared/attachmentStorage.ts',
  'utils/shared/attachmentSync.ts',
  'supabase/migrations/',
  // sync
  'core/sync/',
  'utils/shared/syncQueue.ts',
  'utils/shared/dataBackup.ts',
  'utils/shared/backupValidation.ts',
  // auth
  'core/auth/',
  'utils/auth/',
  'lib/supabase.ts',
];

const ADR_DIR = 'docs/adr/';

function isGoverned(file) {
  return ADR_GOVERNED_PATHS.some((pattern) =>
    pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern,
  );
}

function needsAdr(changedFiles) {
  const governed = changedFiles.filter(isGoverned);
  // En ADR i samme ændring — hvilken som helst — tæller. Om det er den rigtige
  // er et review-spørgsmål; det her fanger dem der slet ikke skrev en.
  const hasAdr = changedFiles.some((file) => file.startsWith(ADR_DIR) && file.endsWith('.md'));
  return { governed, hasAdr, ok: governed.length === 0 || hasAdr };
}

function changedFilesSince(baseRef) {
  const output = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { encoding: 'utf8' });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const baseRef = process.argv[2] || 'main';

  let changed;
  try {
    changed = changedFilesSince(baseRef);
  } catch {
    console.error(`check-adr: kunne ikke sammenligne med "${baseRef}". Angiv en gyldig ref.`);
    process.exit(2);
  }

  const { governed, hasAdr, ok } = needsAdr(changed);

  if (ok) {
    console.log(`check-adr: ok (${governed.length === 0 ? 'ingen styrede filer rørt' : 'ADR fundet'}).`);
    return;
  }

  console.error('check-adr: ændringen rører storage/sync/auth uden en ADR.\n');
  for (const file of governed) console.error(`  ${file}`);
  console.error(
    "\nSkriv en ADR i docs/adr/ — se docs/adr/README.md. Er beslutningen allerede" +
      "\ntruffet i en eksisterende ADR, så henvis til den i commit-beskeden og ret" +
      "\nADR'ens status, hvis den har ændret sig.",
  );
  process.exit(1);
}

module.exports = { ADR_GOVERNED_PATHS, isGoverned, needsAdr };

// Kun når filen køres direkte — så testen kan importere reglerne, uden at den kører.
if (require.main === module) main();
