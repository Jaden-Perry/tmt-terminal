import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Loading } from './components/Panel'
import { WatchlistProvider } from './lib/watchlists'
import Dashboard from './pages/Dashboard'
import Help from './pages/Help'

const Company = lazy(() => import('./pages/Company'))
const Screener = lazy(() => import('./pages/Screener'))
const NewsFeed = lazy(() => import('./pages/NewsFeed'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  return (
    <WatchlistProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="c/:ticker/:tab?" element={<Company />} />
              <Route path="screen" element={<Screener />} />
              <Route path="news" element={<NewsFeed />} />
              <Route path="deals" element={<NewsFeed key="deals" deals />} />
              <Route path="settings" element={<Settings />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Help />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </WatchlistProvider>
  )
}
