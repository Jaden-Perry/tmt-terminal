import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Loading } from './components/Panel'
import { WatchlistProvider } from './lib/watchlists'
import Dashboard from './pages/Dashboard'
import Help from './pages/Help'

const Company = lazy(() => import('./pages/Company'))

export default function App() {
  return (
    <WatchlistProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="c/:ticker/:tab?" element={<Company />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Help />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </WatchlistProvider>
  )
}
