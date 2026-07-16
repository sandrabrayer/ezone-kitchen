import type { AppState } from '../domain/types'
import type { StorageAdapter } from './StorageAdapter'

const STORAGE_KEY = 'ezone-kitchen:v1'

/** Persists the app state as JSON in the browser's localStorage. */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly key: string = STORAGE_KEY) {}

  async load(): Promise<AppState | null> {
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return null
      return JSON.parse(raw) as AppState
    } catch (err) {
      console.warn('Failed to load state from localStorage:', err)
      return null
    }
  }

  async save(state: AppState): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(state))
    } catch (err) {
      console.warn('Failed to save state to localStorage:', err)
    }
  }
}
