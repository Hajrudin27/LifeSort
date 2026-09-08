/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL, PUBLIC_SITE_ORIGIN } from '@/core/config/publicUrls';

/**
 * APP-023 — sletning uden appen.
 *
 * Siden er offentlig og uden login på forhånd, så den er også det sted, hvor en
 * fejl gør mest skade. Testene handler mest om, hvad der IKKE må stå på den.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const PAGE = fs.readFileSync(path.join(REPO_ROOT, 'web', 'account-deletion', 'index.html'), 'utf8');

describe('adressen', () => {
  it('er https og hører til vores domæne', () => {
    for (const url of [ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL]) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url.startsWith(PUBLIC_SITE_ORIGIN)).toBe(true);
    }
  });

  it('står ét sted, så appen og Play Console ikke kan sige forskelligt', () => {
    // Skærmen henter adressen fra konstanten frem for at gentage den.
    const screen = fs.readFileSync(path.join(REPO_ROOT, 'app/settings/delete-account.tsx'), 'utf8');
    expect(screen).toContain('ACCOUNT_DELETION_URL');
    expect(screen).not.toMatch(/https:\/\/lifesort/);
  });
});

describe('siden lækker ingen nøgler', () => {
  it('indeholder ingen servicenøgle', () => {
    // En service_role-nøgle på en offentlig side ville give hvem som helst fuld
    // adgang til hele databasen.
    expect(PAGE).not.toMatch(/service_role/);
    expect(PAGE).not.toMatch(/SUPABASE_SERVICE/);
    expect(PAGE).not.toMatch(/secret/i);
  });

  it('indeholder ingen rigtig nøgle overhovedet — kun pladsholdere', () => {
    // Værdierne udfyldes ved udgivelse. Et JWT eller en sb_-nøgle her ville
    // betyde, at den var havnet i git.
    expect(PAGE).toContain('__SUPABASE_URL__');
    expect(PAGE).toContain('__SUPABASE_PUBLISHABLE_KEY__');
    expect(PAGE).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(PAGE).not.toMatch(/sb_(publishable|secret)_[A-Za-z0-9]{10,}/);
  });
});

describe('identiteten bliver bevist', () => {
  it('kræver en adgangskode, ikke bare en e-mailadresse', () => {
    // Kunne man slette ved at skrive en fremmed adresse, var siden et våben.
    expect(PAGE).toContain('signInWithPassword');
    expect(PAGE).toMatch(/type="password"/);
  });

  it('kræver at adressen skrives to gange', () => {
    expect(PAGE).toMatch(/id="confirm"/);
    expect(PAGE).toContain('mismatch');
  });

  it('bruger den samme sletning som appen', () => {
    // Ellers kunne web og app nå at slette forskellige ting.
    expect(PAGE).toContain("rpc('delete_my_account')");
  });

  it('svarer ens for forkert kodeord og ukendt bruger', () => {
    // Samme regel som i appen (ADR-0014): siden må ikke kunne bruges til at
    // finde ud af, hvem der har en konto.
    expect(PAGE).toMatch(/strings\.wrong/);
    expect(PAGE).not.toMatch(/no_such_user|not registered|findes ikke/i);
  });
});

describe('siden måler ikke på den, der forlader os', () => {
  it('har ingen analytics eller sporing', () => {
    for (const pattern of [/gtag|google-analytics|googletagmanager/i, /facebook|fbq\(/i, /plausible|matomo|mixpanel|segment/i]) {
      expect(PAGE).not.toMatch(pattern);
    }
  });

  it('henter kun Supabase-klienten udefra', () => {
    const externals = [...PAGE.matchAll(/src="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
    expect(externals).toHaveLength(1);
    expect(externals[0]).toContain('@supabase/supabase-js');
  });

  it('beder søgemaskiner om at lade den være', () => {
    expect(PAGE).toMatch(/name="robots"\s+content="noindex"/);
  });
});

describe('siden kan bruges', () => {
  it('findes på begge sprog', () => {
    expect(PAGE).toMatch(/da:\s*\{/);
    expect(PAGE).toMatch(/en:\s*\{/);
  });

  it('fortæller hvad der slettes, og hvad der bliver liggende', () => {
    // Samme oplysning som i appen. En sletteside, der ikke siger det, beder om
    // en tillid, den ikke har gjort sig fortjent til.
    expect(PAGE).toContain('deletedTitle');
    expect(PAGE).toContain('keptTitle');
  });

  it('melder status, også til en skærmlæser', () => {
    expect(PAGE).toMatch(/role="status"/);
    expect(PAGE).toMatch(/aria-live="polite"/);
  });
});
