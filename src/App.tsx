import { useState } from 'react'
import { useApp } from './state/AppContext'
import { WeeklyMenu } from './components/WeeklyMenu'
import { HeadcountView } from './components/HeadcountView'
import { StockView } from './components/StockView'
import { ShoppingListView } from './components/ShoppingListView'
import { BudgetView } from './components/BudgetView'
import { AdminOverview } from './components/AdminOverview'
import { AppBar } from './components/AppBar'

type Tab = 'menu' | 'headcount' | 'stock' | 'shopping' | 'budget' | 'admin'

const BASE_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'menu', label: '🗓️ תפריט שבועי' },
  { id: 'headcount', label: '👥 תפוסה' },
  { id: 'stock', label: '📦 מלאי' },
  { id: 'shopping', label: '🛒 רשימת קניות' },
  { id: 'budget', label: '💰 תקציב' },
]

export default function App() {
  const { role, activeHouse } = useApp()
  const [tab, setTab] = useState<Tab>('menu')

  const tabs = role === 'admin' ? [...BASE_TABS, { id: 'admin' as Tab, label: '🏠 כל הבתים' }] : BASE_TABS

  return (
    <>
      <AppBar />
      <div className="app">
        {!activeHouse ? (
          <div className="card">אין בתים. הוסיפו בית כדי להתחיל.</div>
        ) : (
          <>
            <nav className="tabs no-print" aria-label="ניווט">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  aria-current={tab === t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === 'menu' && <WeeklyMenu />}
            {tab === 'headcount' && <HeadcountView />}
            {tab === 'stock' && <StockView />}
            {tab === 'shopping' && <ShoppingListView />}
            {tab === 'budget' && <BudgetView />}
            {tab === 'admin' && role === 'admin' && <AdminOverview />}
          </>
        )}
      </div>
    </>
  )
}
