import { useApp } from '../state/AppContext'

export function AppBar() {
  const { state, activeHouse, setActiveHouse, addHouse, role, setRole } = useApp()

  return (
    <header className="appbar no-print">
      <div className="appbar-inner">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#2f7d5b" />
            <path
              d="M11 7c-1.7 0-3 1.5-3 3.3 0 1.4.8 2.6 2 3.1V24a1 1 0 0 0 2 0V13.4c1.2-.5 2-1.7 2-3.1C15 8.5 13.7 7 12 7h-1zm11 0a4 4 0 0 0-4 4c0 1.9 1.3 3.4 3 3.9V24a1 1 0 0 0 2 0V7z"
              fill="#fff"
            />
          </svg>
          <span>ezone kitchen</span>
        </div>

        <div className="spacer" />

        <div className="controls">
          <label className="muted" htmlFor="house-select">
            בית:
          </label>
          <select
            id="house-select"
            value={activeHouse?.id ?? ''}
            onChange={(e) => setActiveHouse(e.target.value)}
          >
            {state.houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            title="הוסף בית"
            onClick={() => {
              const name = window.prompt('שם הבית החדש:')
              if (name) addHouse(name)
            }}
          >
            ＋
          </button>

          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'cook' | 'admin')}
            aria-label="תפקיד"
            title="תפקיד"
          >
            <option value="cook">טבח/ית</option>
            <option value="admin">מנהל/ת</option>
          </select>
        </div>
      </div>
    </header>
  )
}
