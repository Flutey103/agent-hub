import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type ThemeChoice = "light" | "dark" | "system"
const STORAGE_KEY = "agent-hub.theme"

interface ThemeContextValue {
  theme: ThemeChoice
  resolved: "light" | "dark"
  setTheme: (theme: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolve(theme: ThemeChoice): "light" | "dark" {
  if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  return theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system"
  })
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(theme))

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const next = resolve(theme)
      document.documentElement.classList.toggle("dark", next === "dark")
      setResolved(next)
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  function setTheme(next: ThemeChoice) {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("ThemeProvider is missing")
  return value
}
