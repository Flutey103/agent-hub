import type { Session } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { supabase } from "./supabase"

interface AuthContextValue {
  ready: boolean
  session: Session | null
  recovery: boolean
  clearRecovery: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function recoveryInUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const query = new URLSearchParams(window.location.search)
  return hash.get("type") === "recovery" || query.get("type") === "recovery"
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(recoveryInUrl)

  useEffect(() => {
    let settled = false
    const settle = (next: Session | null) => {
      settled = true
      setSession(next)
      setReady(true)
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true)
      settle(next)
    })
    const timer = window.setTimeout(() => {
      if (settled) return
      void supabase.auth.getSession().then(({ data }) => {
        if (!settled) settle(data.session)
      })
    }, 2000)
    return () => {
      window.clearTimeout(timer)
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={{ ready, session, recovery, clearRecovery: () => setRecovery(false) }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("AuthProvider is missing")
  return value
}

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/home"
  return value
}
