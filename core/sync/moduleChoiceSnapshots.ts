import { supabase } from '@/lib/supabase';
import {
  type ConfirmedModuleChoice,
  ModuleChoiceSnapshotError,
  parseModuleChoiceSnapshots,
  reconcileModuleChoiceSnapshots,
} from '@/core/sync/moduleChoiceReconciliation';

export type ModuleChoiceFetchResult =
  | { ok: true }
  | { ok: false; reason: 'authorization' | 'unavailable' | 'invalid' | 'invariant' | 'pending' };

/**
 * Explicit, in-memory confirmed-state handle for one account. Metadata survives
 * successive fetches; a new handle starts empty. No persistence or UI store wiring.
 * Caller disposes on account cleanup and never uses this as an optimistic store.
 */
export function createModuleChoiceSnapshots(accountId: string) {
  if (!accountId.trim()) throw new Error('Module choice account is unavailable.');
  let entities: readonly ConfirmedModuleChoice[] = Object.freeze([]);
  let disposed = false;

  return {
    getSnapshot: () => Object.freeze({ accountId, entities }),
    dispose() {
      disposed = true;
      entities = Object.freeze([]);
    },
    async fetch(pendingEntityIds: readonly string[]): Promise<ModuleChoiceFetchResult> {
      const pending = [...pendingEntityIds];
      if (disposed) return { ok: false, reason: 'authorization' };
      // Conservative refusal, not a choice between local and remote versions.
      if (pending.length) return { ok: false, reason: 'pending' };
      try {
        const { data, error } = await supabase.auth.getSession();
        const session = data.session;
        if (disposed || error || !session || session.user.id !== accountId) {
          return { ok: false, reason: 'authorization' };
        }
        const response = await supabase.from('user_modules')
          .select('module_id, enabled, revision::text, updated_at')
          .eq('user_id', accountId)
          .setHeader('Authorization', `Bearer ${session.access_token}`)
          .retry(false);
        // Do not publish a response after cleanup or an intervening account switch.
        const current = await supabase.auth.getSession();
        if (disposed || current.error || current.data.session?.user.id !== accountId) {
          return { ok: false, reason: 'authorization' };
        }
        if (response.error) return { ok: false, reason: 'unavailable' };
        // Merge into the latest state on completion, so overlapping reads cannot
        // regress it when an older response arrives last. Replace only on success.
        entities = reconcileModuleChoiceSnapshots(entities, parseModuleChoiceSnapshots(response.data), pending);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof ModuleChoiceSnapshotError ? error.reason : 'unavailable' };
      }
    },
  };
}
