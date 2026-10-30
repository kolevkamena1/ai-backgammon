import { logger } from '@/lib/logger'
import { createJSONStorage, type PersistStorage } from 'zustand/middleware'

/**
 * Builds a localStorage-backed `PersistStorage` that never throws.
 *
 * Zustand v5 has no `onError` on persist options, and a hostile storage environment (private
 * mode, storage disabled, quota exceeded) must not break the app: every call is wrapped so the
 * failure is logged once and the store simply keeps its values in memory for this session.
 * Shared by every persisted store so the semantics cannot drift.
 *
 * @param label names the store in logs only — never a credential.
 */
export function createSafeStorage<T>(label: string): PersistStorage<T> {
  const jsonStorage = createJSONStorage<T>(() => localStorage)

  return {
    getItem: (name) => {
      try {
        return jsonStorage?.getItem(name) ?? null
      } catch (error) {
        logger.error('storage read failed', { reason: String(error), storage: label })
        return null
      }
    },
    setItem: (name, value) => {
      try {
        jsonStorage?.setItem(name, value)
      } catch (error) {
        logger.error('storage write failed', { reason: String(error), storage: label })
      }
    },
    removeItem: (name) => {
      try {
        jsonStorage?.removeItem(name)
      } catch (error) {
        logger.error('storage removal failed', { reason: String(error), storage: label })
      }
    },
  }
}
