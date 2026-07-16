import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { newId } from '../domain/id'
import { copyWeekInto } from '../domain/menuOps'
import type {
  AppState,
  DayKey,
  House,
  Meal,
  Role,
  WeekMenu,
} from '../domain/types'
import { emptyWeekMenu, shiftWeek, weekStart } from '../domain/weeks'
import { LocalStorageAdapter } from '../storage/LocalStorageAdapter'
import type { StorageAdapter } from '../storage/StorageAdapter'
import { seedState } from './seed'

interface AppContextValue {
  state: AppState
  role: Role
  activeHouse: House | undefined
  currentWeekOf: string
  setRole: (role: Role) => void
  setActiveHouse: (id: string) => void
  addHouse: (name: string) => void
  goToWeek: (weekOf: string) => void
  shiftCurrentWeek: (weeks: number) => void
  updateHouse: (id: string, mutate: (house: House) => House) => void
  updateActiveHouse: (mutate: (house: House) => House) => void
  /** Ensure the active house has a WeekMenu for the current week, returning it. */
  ensureWeek: (weekOf: string) => WeekMenu
  copyLastWeek: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  children,
  adapter = new LocalStorageAdapter(),
}: {
  children: ReactNode
  adapter?: StorageAdapter
}) {
  const [state, setState] = useState<AppState>(() => seedState())
  const [currentWeekOf, setCurrentWeekOf] = useState<string>(() => weekStart(new Date()))
  const [loaded, setLoaded] = useState(false)
  const adapterRef = useRef(adapter)

  // Load persisted state once on mount.
  useEffect(() => {
    let cancelled = false
    adapterRef.current.load().then((loadedState) => {
      if (cancelled) return
      if (loadedState && Array.isArray(loadedState.houses) && loadedState.houses.length > 0) {
        setState(loadedState)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist on every change (after the initial load).
  useEffect(() => {
    if (!loaded) return
    void adapterRef.current.save(state)
  }, [state, loaded])

  const setRole = useCallback((role: Role) => {
    setState((s) => ({ ...s, role }))
  }, [])

  const setActiveHouse = useCallback((id: string) => {
    setState((s) => ({ ...s, activeHouseId: id }))
  }, [])

  const addHouse = useCallback((name: string) => {
    const house: House = {
      id: newId('house'),
      name: name.trim() || 'בית חדש',
      headcount: { basePatients: 0, baseStaff: 0, overrides: {} },
      allergies: [],
      stock: [],
      weeks: {},
      weeklyBudget: 0,
      prices: [],
      spendLog: [],
    }
    setState((s) => ({ ...s, houses: [...s.houses, house], activeHouseId: house.id }))
  }, [])

  const updateHouse = useCallback((id: string, mutate: (house: House) => House) => {
    setState((s) => ({
      ...s,
      houses: s.houses.map((h) => (h.id === id ? mutate(h) : h)),
    }))
  }, [])

  const activeHouse = useMemo(
    () => state.houses.find((h) => h.id === state.activeHouseId) ?? state.houses[0],
    [state.houses, state.activeHouseId],
  )

  const updateActiveHouse = useCallback(
    (mutate: (house: House) => House) => {
      if (!activeHouse) return
      updateHouse(activeHouse.id, mutate)
    },
    [activeHouse, updateHouse],
  )

  const ensureWeek = useCallback(
    (weekOf: string): WeekMenu => {
      const existing = activeHouse?.weeks[weekOf]
      if (existing) return existing
      const fresh = emptyWeekMenu(weekOf)
      if (activeHouse) {
        updateHouse(activeHouse.id, (h) => ({
          ...h,
          weeks: { ...h.weeks, [weekOf]: fresh },
        }))
      }
      return fresh
    },
    [activeHouse, updateHouse],
  )

  const copyLastWeek = useCallback(() => {
    if (!activeHouse) return
    const prevWeekOf = shiftWeek(currentWeekOf, -1)
    const prev = activeHouse.weeks[prevWeekOf]
    if (!prev) return
    const copied = copyWeekInto(prev, currentWeekOf)
    updateHouse(activeHouse.id, (h) => ({
      ...h,
      weeks: { ...h.weeks, [currentWeekOf]: copied },
    }))
  }, [activeHouse, currentWeekOf, updateHouse])

  const goToWeek = useCallback((weekOf: string) => setCurrentWeekOf(weekOf), [])
  const shiftCurrentWeek = useCallback(
    (weeks: number) => setCurrentWeekOf((w) => shiftWeek(w, weeks)),
    [],
  )

  const value: AppContextValue = {
    state,
    role: state.role,
    activeHouse,
    currentWeekOf,
    setRole,
    setActiveHouse,
    addHouse,
    goToWeek,
    shiftCurrentWeek,
    updateHouse,
    updateActiveHouse,
    ensureWeek,
    copyLastWeek,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}

export type { DayKey, Meal }
