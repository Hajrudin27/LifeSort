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

  it('keeps ACK/reconciliation out of the B2A transport and queue-adapter boundary', () => {
    for (const file of ['core/pregnancy/syncTransport.ts', 'core/pregnancy/syncQueue.ts']) {
      const executable = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(executable).not.toMatch(/acknowledge|reconcile|rebaseline/);
    }
  });
});
