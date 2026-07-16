import type { AppState } from '../domain/types'

/**
 * Persistence boundary for the whole app.
 *
 * v1 ships a {@link LocalStorageAdapter}. Because the entire app talks to this
 * interface (never to `localStorage` directly), a future server/database
 * adapter can be dropped in with NO changes to the domain model or the UI —
 * it only needs to implement `load` and `save`. This is what keeps
 * "admin view all houses" upgradeable from single-device to multi-device.
 */
export interface StorageAdapter {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<void>
}
