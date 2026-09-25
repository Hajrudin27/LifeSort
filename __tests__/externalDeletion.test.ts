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

/**
 * APP-055 på websiden.
 *
 * De øvrige tests her læser siden som tekst. Rækkefølge og fejl-lukning kan man
 * ikke læse sig til, så de her kører faktisk sidens eget script: det inline
 * script hentes ud, evalueres med et minimalt DOM, og den rigtige submit-handler
 * kaldes. Ingen testkrog i produktionskoden — scriptets egne deklarationer
 * returneres fra den funktion, de i forvejen ligger i.
 */

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const OTHER_USER = '8c2d1e4f-7b3a-4c5d-9e0f-1a2b3c4d5e6f';
const DOC_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DOC_B = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const P = `${USER}/${DOC_A}`;

type Scenario = {
  signInError?: unknown;
  releaseData?: unknown;
  releaseError?: unknown;
  releaseThrows?: boolean;
  removeError?: unknown;
  removeThrows?: boolean;
  accountError?: { message: string } | null;
  accountThrows?: boolean;
  signOutThrows?: boolean;
  signOutError?: unknown;
  language?: 'da' | 'en';
};

type Run = {
  calls: string[];
  status: { message: string; kind: string };
  strings: Record<string, string>;
  formHidden: boolean;
  submitDisabled: boolean;
  manifest: (data: unknown, userId: unknown) => string[] | null;
};

/** Enough DOM for the page's own script to run unchanged. */
function fakeDom(language: 'da' | 'en') {
  const listeners: Record<string, (event: { preventDefault: () => void }) => Promise<void>> = {};
  const status = { textContent: '', kind: 'info' };
  const form = {
    hidden: false,
    addEventListener: (name: string, fn: never) => { listeners[name] = fn; },
  };
  const submit = { disabled: false };
  const fields: Record<string, { value: string }> = {
    email: { value: 'someone@example.test' },
    password: { value: 'correct horse battery staple' },
    confirm: { value: 'someone@example.test' },
  };

  const node = {
    getAttribute: () => null,
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    textContent: '',
  };

  // One stable element, so the script's captured reference and the assertions
  // below look at the same thing. Defined with defineProperty rather than an
  // object literal: the transpiled object spread does not preserve accessors.
  const statusNode: Record<string, unknown> = {
    getAttribute: () => null,
    addEventListener: () => undefined,
    setAttribute: (_name: string, value: string) => { status.kind = value; },
  };
  Object.defineProperty(statusNode, 'textContent', {
    get: () => status.textContent,
    set: (value: string) => { status.textContent = value; },
  });

  const document = {
    documentElement: { lang: language },
    getElementById: (id: string) => {
      if (id === 'form') return form;
      if (id === 'submit') return submit;
      if (id === 'status') return statusNode;
      return fields[id] ?? node;
    },
    querySelectorAll: () => ({ forEach: () => undefined }),
  };

  return { document, listeners, status, form, submit };
}

async function runPage(scenario: Scenario = {}): Promise<Run> {
  const language = scenario.language ?? 'da';
  const inline = PAGE.match(/<script>([\s\S]*?)<\/script>/);
  if (!inline) throw new Error('siden har intet inline script');

  const calls: string[] = [];
  const { document, listeners, status, form, submit } = fakeDom(language);

  const client = {
    auth: {
      signInWithPassword: async () => {
        calls.push('signInWithPassword');
        return scenario.signInError
          ? { data: { user: null }, error: scenario.signInError }
          : { data: { user: { id: USER } }, error: null };
      },
      signOut: async () => {
        calls.push('signOut');
        // Both shapes a client can fail with: a thrown connection error, and a
        // returned { error }. Neither may reach back and change the deletion.
        if (scenario.signOutThrows) throw new Error('network');
        return { error: scenario.signOutError ?? null };
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push(`remove.${bucket}:${paths.join(',')}`);
          if (scenario.removeThrows) throw new Error('network');
          return { data: null, error: scenario.removeError ?? null };
        },
      }),
    },
    rpc: async (name: string) => {
      calls.push(`rpc.${name}`);
      if (name === 'release_my_documents_for_account_deletion') {
        if (scenario.releaseThrows) throw new Error('network');
        if (scenario.releaseError) return { data: null, error: scenario.releaseError };
        return { data: scenario.releaseData ?? [], error: null };
      }
      // A throw is the connection dying, not the server answering "no".
      if (scenario.accountThrows) throw new Error('network');
      return { data: null, error: scenario.accountError ?? null };
    },
  };

  const globals = {
    supabase: { createClient: () => client },
  };

  // The script's own declarations are returned from the scope they already live
  // in, so nothing has to be exported from the page for this to be testable.
  const factory = new Function(
    'document', 'navigator', 'window',
    `${inline[1]}\n; return { canonicalDocumentManifest: canonicalDocumentManifest, COPY: COPY, lang: lang };`,
  );
  const exported = factory(document, { language: language === 'en' ? 'en-GB' : 'da-DK' }, globals);

  await listeners.submit({ preventDefault: () => undefined });

  return {
    calls,
    status: { message: status.textContent, kind: status.kind },
    strings: exported.COPY[language],
    formHidden: form.hidden,
    submitDisabled: submit.disabled,
    manifest: exported.canonicalDocumentManifest,
  };
}

describe('APP-055 — websiden rydder dokumenter før kontoen', () => {
  it('A + K: rækkefølgen er kodeord → frigivelse → objekter → konto', async () => {
    const run = await runPage({ releaseData: [P] });

    expect(run.calls).toEqual([
      'signInWithPassword',
      'rpc.release_my_documents_for_account_deletion',
      `remove.documents:${P}`,
      'rpc.delete_my_account',
      'signOut',
    ]);
    expect(run.status.message).toBe(run.strings.done);
    expect(run.formHidden).toBe(true);
  });

  it('B: en konto uden dokumenter springer Storage over og sletter kontoen', async () => {
    const run = await runPage({ releaseData: [] });

    expect(run.calls).toContain('rpc.release_my_documents_for_account_deletion');
    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expect(run.calls).toContain('rpc.delete_my_account');
    expect(run.status.message).toBe(run.strings.done);
  });

  it('flere dokumenter fjernes i ét kald, komplet', async () => {
    const run = await runPage({ releaseData: [P, `${USER}/${DOC_B}`] });
    expect(run.calls).toContain(`remove.documents:${P},${USER}/${DOC_B}`);
    expect(run.calls).toContain('rpc.delete_my_account');
  });
});

describe('APP-055 — websiden fejler lukket', () => {
  const expectNoDeletion = (run: Run) => {
    expect(run.calls).not.toContain('rpc.delete_my_account');
    expect(run.status.message).toBe(run.strings.failed);
    expect(run.status.kind).toBe('error');
    expect(run.submitDisabled).toBe(false);
    expect(run.formHidden).toBe(false);
  };

  it('C: en fejlet frigivelse stopper alt', async () => {
    const run = await runPage({ releaseError: { message: 'offline' } });
    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expectNoDeletion(run);
  });

  it('C: en kastet frigivelse stopper alt', async () => {
    const run = await runPage({ releaseThrows: true });
    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expectNoDeletion(run);
  });

  it.each([
    ['D: et malformet manifest', [P, `${USER}/ikke-et-uuid`]],
    ['D: et ekstra sti-segment', [P, `${USER}/${DOC_B}/navn.pdf`]],
    ['D: et element der ikke er en streng', [P, 7]],
    ['E: en fremmed sti', [P, `${OTHER_USER}/${DOC_B}`]],
    ['F: en dubleret sti', [P, P]],
    ['en traversal', [`${USER}/../${OTHER_USER}/${DOC_A}`]],
    ['et svar der ikke er en liste', 'not-an-array'],
  ])('%s afviser HELE oprydningen — intet delvist fjernet', async (_label, releaseData) => {
    const run = await runPage({ releaseData });

    // Ingen delvis oprydning: heller ikke den gyldige sti bliver rørt.
    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expect(run.calls.join(' ')).not.toContain(P);
    expectNoDeletion(run);
  });

  it('G: en Storage-fejl stopper kontosletningen', async () => {
    const run = await runPage({ releaseData: [P], removeError: { message: 'row-level security' } });
    expect(run.calls).toContain(`remove.documents:${P}`);
    expectNoDeletion(run);
  });

  it('H: en kastet Storage-fejl stopper kontosletningen', async () => {
    const run = await runPage({ releaseData: [P], removeThrows: true });
    expectNoDeletion(run);
  });

  it('J: forkert kodeord rører hverken frigivelse eller sletning', async () => {
    const run = await runPage({ signInError: { message: 'invalid' } });
    expect(run.calls).toEqual(['signInWithPassword']);
    expect(run.status.message).toBe(run.strings.wrong);
  });
});

describe('APP-055 — websiden lyver ikke om delvis fejl', () => {
  it('I: siger det, når filerne er væk men kontoen består', async () => {
    const run = await runPage({ releaseData: [P], accountError: { message: 'unexpected_failure' } });

    expect(run.calls).toContain(`remove.documents:${P}`);
    expect(run.status.message).toBe(run.strings.failedAfterFiles);
    expect(run.status.message).not.toBe(run.strings.failed);
    expect(run.status.message).not.toBe(run.strings.done);
  });

  it('påstår ikke at filer blev fjernet, når der ingen var', async () => {
    const run = await runPage({ releaseData: [], accountError: { message: 'unexpected_failure' } });
    expect(run.status.message).toBe(run.strings.failed);
  });

  it('3: en admin-konto siger BÅDE support og at filerne allerede er væk', async () => {
    const run = await runPage({ releaseData: [P], accountError: { message: 'admin_account' } });

    // At kontoen kræver support, må ikke skjule at dokumenter allerede er
    // fjernet. Brugeren ville ellers aldrig få det at vide.
    expect(run.status.message).toBe(run.strings.adminAfterFiles);
    expect(run.status.message).not.toBe(run.strings.admin);
    expect(run.status.message).not.toBe(run.strings.failed);
  });

  it('4: en admin-konto uden dokumenter beholder den gamle besked', async () => {
    const run = await runPage({ releaseData: [], accountError: { message: 'admin_account' } });
    expect(run.status.message).toBe(run.strings.admin);
  });

  it('1: et kald der KASTER efter filerne er væk, påstår ikke at kontoen består', async () => {
    const run = await runPage({ releaseData: [P], accountThrows: true });

    expect(run.calls).toContain(`remove.documents:${P}`);
    expect(run.status.message).toBe(run.strings.unknownAfterFiles);
    expect(run.status.kind).toBe('error');

    // Ikke succes, og siden kan bruges igen.
    expect(run.status.message).not.toBe(run.strings.done);
    expect(run.formHidden).toBe(false);
    expect(run.submitDisabled).toBe(false);

    // Den siger begge dele: sletningen er ubekræftet, og filerne er væk. Den
    // siger IKKE det stærkere "kontoen blev ikke slettet", for det ved den ikke.
    expect(run.status.message).not.toBe(run.strings.failedAfterFiles);
    for (const phrase of ['bekræfte', 'confirm']) {
      if (run.strings.unknownAfterFiles.includes(phrase)) expect(run.status.message).toContain(phrase);
    }
  });

  it('2: et kald der kaster uden dokumenter giver den almindelige fejl', async () => {
    const run = await runPage({ releaseData: [], accountThrows: true });

    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expect(run.status.message).toBe(run.strings.failed);
    expect(run.status.message).not.toBe(run.strings.unknownAfterFiles);
    expect(run.status.message).not.toBe(run.strings.failedAfterFiles);
    expect(run.submitDisabled).toBe(false);
  });

  it('en tom liste påstår aldrig at der blev fjernet filer', async () => {
    for (const scenario of [
      { releaseData: [], accountError: { message: 'unexpected_failure' } },
      { releaseData: [], accountThrows: true },
    ]) {
      const run = await runPage(scenario);
      expect(run.status.message).toBe(run.strings.failed);
    }
  });

  it.each(['da', 'en'] as const)('5: har alle tre delvis-fejl-beskeder på %s', async (language) => {
    const run = await runPage({ releaseData: [P], accountError: { message: 'x' }, language });

    for (const key of ['failedAfterFiles', 'adminAfterFiles', 'unknownAfterFiles']) {
      expect(typeof run.strings[key]).toBe('string');
      expect(run.strings[key].trim()).not.toBe('');
    }
    // Hver tilstand har sin egen tekst; ellers kunne to forskellige fakta se ens ud.
    expect(new Set([run.strings.failed, run.strings.admin, run.strings.failedAfterFiles,
      run.strings.adminAfterFiles, run.strings.unknownAfterFiles]).size).toBe(5);
    expect(run.status.message).toBe(run.strings.failedAfterFiles);
  });

  it.each(['da', 'en'] as const)('6: ingen delvis-fejl-besked røber sti, bruger eller dokument på %s', async (language) => {
    const run = await runPage({ releaseData: [P], accountThrows: true, language });

    const messages = [run.strings.failed, run.strings.admin, run.strings.failedAfterFiles,
      run.strings.adminAfterFiles, run.strings.unknownAfterFiles, run.status.message];
    for (const message of messages) {
      for (const secret of [P, USER, DOC_A, 'documents/', 'storage']) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

describe('APP-055 — en bekræftet sletning kan ikke tages tilbage af oprydningen', () => {
  const expectFinalSuccess = (run: Run) => {
    expect(run.status.message).toBe(run.strings.done);
    expect(run.formHidden).toBe(true);
    // Ingen vej tilbage til "prøv igen": handlingen lykkedes.
    expect(run.submitDisabled).toBe(true);
    for (const wrong of [run.strings.failed, run.strings.failedAfterFiles,
      run.strings.unknownAfterFiles, run.strings.adminAfterFiles, run.strings.admin]) {
      expect(run.status.message).not.toBe(wrong);
    }
  };

  it('A: signOut der kaster efter en vellykket sletning MED dokumenter', async () => {
    const run = await runPage({ releaseData: [P], signOutThrows: true });

    expect(run.calls).toContain(`remove.documents:${P}`);
    expect(run.calls.filter((call) => call === 'rpc.delete_my_account')).toHaveLength(1);
    expect(run.calls).toContain('signOut');
    expectFinalSuccess(run);
  });

  it('B: signOut der kaster efter en vellykket sletning UDEN dokumenter', async () => {
    const run = await runPage({ releaseData: [], signOutThrows: true });

    expect(run.calls.some((call) => call.startsWith('remove.'))).toBe(false);
    expect(run.calls.filter((call) => call === 'rpc.delete_my_account')).toHaveLength(1);
    expectFinalSuccess(run);
  });

  it('C: signOut der svarer med { error } ændrer heller ingenting', async () => {
    const run = await runPage({ releaseData: [P], signOutError: { message: 'session already gone' } });

    expect(run.calls).toContain('signOut');
    expectFinalSuccess(run);
  });

  it('prøver ikke sletningen igen, fordi oprydningen fejlede', async () => {
    const run = await runPage({ releaseData: [P], signOutThrows: true });

    // Én frigivelse, én fjernelse, én sletning. Et gentaget kald ville i bedste
    // fald være støj og i værste fald en handling på en konto der ikke findes.
    expect(run.calls.filter((c) => c === 'rpc.release_my_documents_for_account_deletion')).toHaveLength(1);
    expect(run.calls.filter((c) => c.startsWith('remove.documents'))).toHaveLength(1);
    expect(run.calls.filter((c) => c === 'rpc.delete_my_account')).toHaveLength(1);
  });

  it('D: de to tilstande kan ikke forveksles', async () => {
    // Kaldet selv kaster: serveren svarede aldrig, så udfaldet er ubekræftet.
    const unconfirmed = await runPage({ releaseData: [P], accountThrows: true });
    // Kaldet lykkedes, og først DEREFTER fejlede oprydningen: sletningen står ved magt.
    const confirmed = await runPage({ releaseData: [P], signOutThrows: true });

    expect(unconfirmed.status.message).toBe(unconfirmed.strings.unknownAfterFiles);
    expect(confirmed.status.message).toBe(confirmed.strings.done);
    expect(unconfirmed.status.message).not.toBe(confirmed.status.message);

    // Og de opfører sig modsat: den ene inviterer til et nyt forsøg, den anden ikke.
    expect(unconfirmed.formHidden).toBe(false);
    expect(unconfirmed.submitDisabled).toBe(false);
    expect(confirmed.formHidden).toBe(true);
    expect(confirmed.submitDisabled).toBe(true);

    // Det kastende kald nåede aldrig frem; signOut blev derfor heller ikke forsøgt.
    expect(unconfirmed.calls).not.toContain('signOut');
    expect(confirmed.calls).toContain('signOut');
  });

  it('en fejl FØR sletningen stopper stadig alt', async () => {
    // Rettelsen må ikke have gjort den brede catch harmløs for alt andet.
    const run = await runPage({ releaseData: [P], removeError: { message: 'row-level security' }, signOutThrows: true });

    expect(run.calls).not.toContain('rpc.delete_my_account');
    expect(run.calls).not.toContain('signOut');
    expect(run.status.message).toBe(run.strings.failed);
    expect(run.formHidden).toBe(false);
  });
});

describe('APP-055 — manifestkontrakten på websiden', () => {
  let manifest: Run['manifest'];
  beforeAll(async () => { manifest = (await runPage({ releaseData: [] })).manifest; });

  it('tom liste er gyldig', () => expect(manifest([], USER)).toEqual([]));

  it('kanoniske stier kommer komplet igennem', () => {
    expect(manifest([P, `${USER}/${DOC_B}`], USER)).toEqual([P, `${USER}/${DOC_B}`]);
  });

  it.each([
    ['fremmed ejer', [`${OTHER_USER}/${DOC_A}`]],
    ['ekstra segment', [`${USER}/${DOC_A}/navn.pdf`]],
    ['malformet dokument-id', [`${USER}/nope`]],
    ['malformet ejer-id', ['nope/' + DOC_A]],
    ['ikke en streng', [7]],
    ['null-element', [null]],
    ['dublet', [P, P]],
    ['blandet gyldig og ugyldig', [P, `${USER}/x`]],
    ['tom streng', ['']],
    ['ikke en liste', 'nope'],
  ])('%s giver null', (_label, data) => expect(manifest(data, USER)).toBeNull());

  it('et ubrugeligt bruger-id giver null', () => {
    expect(manifest([P], 'ikke-et-uuid')).toBeNull();
    expect(manifest([P], undefined)).toBeNull();
  });
});

describe('APP-055 — websiden røber ingenting', () => {
  it('viser hverken sti eller bruger-id', async () => {
    const run = await runPage({ releaseData: [P], accountError: { message: 'x' } });
    for (const secret of [P, USER, DOC_A]) {
      expect(run.status.message).not.toContain(secret);
      expect(run.strings.failedAfterFiles).not.toContain(secret);
    }
  });

  it('gemmer ikke manifestet nogen steder', () => {
    expect(PAGE).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(PAGE).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it('bruger den normale Storage-API og ingen servicerolle', () => {
    expect(PAGE).toContain("storage.from(DOCUMENTS_BUCKET)");
    expect(PAGE).not.toMatch(/storage\.objects/);
    expect(PAGE).not.toMatch(/service_role/);
  });
});
