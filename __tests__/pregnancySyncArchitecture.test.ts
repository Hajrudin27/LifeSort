import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('APP-076 B2A architecture boundary', () => {
  it('keeps the production lifecycle ordinary-only: B2B owns Pregnancy registration', () => {
    const lifecycle = read('hooks/useSyncCoordinatorLifecycle.ts');
    expect(lifecycle).toContain('createSyncCoordinator');
    expect(lifecycle).not.toMatch(/pregnancy|syncQueue|syncTransport/i);
  });

  it('keeps Profile-B queue code out of the plaintext ordinary outbox', () => {
    for (const file of ['core/pregnancy/syncQueue.ts', 'core/pregnancy/syncTransport.ts']) {
      expect(read(file)).not.toMatch(/createOutbox|lifesort-outbox|AsyncStorage/);
    }
  });

  it('keeps ACK/reconciliation out of the transport, pull and queue-adapter boundary', () => {
    for (const file of ['core/pregnancy/syncTransport.ts', 'core/pregnancy/syncQueue.ts', 'core/pregnancy/syncPull.ts', 'core/pregnancy/canonicalReaders.ts']) {
      const executable = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(executable).not.toMatch(/acknowledge|reconcile|rebaseline/);
    }
  });

  it('B2B1: the internal Pregnancy backend is registered nowhere in production code', () => {
    const production = ['app', 'components', 'hooks', 'store', 'utils', 'lib', 'core', 'services']
      .flatMap((dir) => (fs.existsSync(path.join(root, dir)) ? walk(path.join(root, dir)) : []));
    const importers = production.filter((file) => /@\/core\/pregnancy\/syncBackend|\.\/syncBackend|createPregnancySyncBackend/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(importers).toEqual(['core/pregnancy/syncBackend.ts']);
    expect(read('hooks/useSyncCoordinatorLifecycle.ts')).not.toMatch(/syncBackend|createPregnancySyncBackend|PREGNANCY_SYNC_BACKEND_ID/);
    expect(read('core/sync/syncCoordinator.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/createPregnancySyncBackend|syncBackend/);
  });

  it('B2B1: the Pregnancy sync modules never log or console-print anything', () => {
    for (const file of ['core/pregnancy/syncBackend.ts', 'core/pregnancy/syncPull.ts', 'core/pregnancy/canonicalReaders.ts', 'core/pregnancy/canonicalMappers.ts', 'core/pregnancy/reconciliation.ts', 'core/pregnancy/protectedRepository.ts', 'core/pregnancy/syncTransport.ts', 'core/pregnancy/syncQueue.ts']) {
      const executable = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(executable).not.toMatch(/console\.|safeLog|Sentry|analytics|track\(/i);
    }
  });

  it('B2B1: the public repository has no blind acknowledge and the reconciliation entry takes proofs, not ids', () => {
    const repository = read('core/pregnancy/protectedRepository.ts');
    expect(repository).not.toMatch(/acknowledge\s*:/);
    expect(repository).not.toMatch(/ackMutationIds/);
    expect(read('core/pregnancy/reconciliation.ts')).not.toMatch(/ackMutationIds/);
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
