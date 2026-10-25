import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/** Fetch JSON from the backend; re-fetches when `path` changes. Pass null to skip. */
export function useApi<T = any>(path: string | null, opts?: { pollMs?: number }) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return
      const my = ++seq.current
      if (!quiet) setLoading(true)
      try {
        const d = await api<T>(path)
        if (my === seq.current) {
          setData(d)
          setError(null)
        }
      } catch (e) {
        if (my === seq.current) setError((e as Error).message)
      } finally {
        if (my === seq.current) setLoading(false)
      }
    },
    [path],
  )

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  useEffect(() => {
    if (!opts?.pollMs) return
    const id = setInterval(() => load(true), opts.pollMs)
    return () => clearInterval(id)
  }, [load, opts?.pollMs])

  return { data, error, loading, reload: load, setData }
}
