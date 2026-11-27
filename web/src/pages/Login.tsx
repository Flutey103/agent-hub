import { useState, type FormEvent } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { checkEmailSignIn, magicLinkErrorMessage, signInErrorMessage } from "@/lib/auth-copy"
import { safeNext, useAuth } from "@/lib/auth"
import { supabase, supabaseConfigured } from "@/lib/supabase"
import { usePageTitle } from "@/lib/utils"
import { AuthLayout, Notice } from "./AuthLayout"
import { LoadingScreen } from "./LoadingScreen"

export default function LoginPage() {
  if (!supabaseConfigured) return <LoginForm />
  return <LoginGate />
}

function LoginGate() {
  const { ready, session, recovery } = useAuth()
  if (!ready) return <LoadingScreen />
  if (recovery) return <Navigate to="/reset-password" replace />
  if (session) return <Navigate to="/home" replace />
  return <LoginForm />
}

function LoginForm() {
  usePageTitle(`Sign in — ${productName}`)
  const [params] = useSearchParams()
  const next = safeNext(params.get("next"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<"password" | "link" | null>(null)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabaseConfigured) {
      setError("This build has no sign-in service configured.")
      return
    }
    setBusy("password")
    setError(null)
    setNotice(null)
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(null)
    if (signError) setError(signInErrorMessage(signError.message))
    else window.location.assign(next)
  }

  async function sendLink() {
    if (!email) {
      setError("Enter your email and we'll send the link.")
      return
    }
    if (!supabaseConfigured) {
      setError("This build has no sign-in service configured.")
      return
    }
    setBusy("link")
    setError(null)
    setNotice(null)
    const { error: linkError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(null)
    if (linkError) setError(magicLinkErrorMessage(linkError.message))
    else setNotice(checkEmailSignIn(email))
  }

  return (
    <AuthLayout title="Sign in" subtitle={`Use your ${productName} account. Invited people can get in with an email link.`}>
      <form className="space-y-3" onSubmit={signIn}>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <div className="text-right">
          <Link className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === "password" ? "Signing in…" : "Sign in"}
        </Button>
        <Button type="button" variant="outline" className="w-full" disabled={busy !== null} onClick={() => void sendLink()}>
          {busy === "link" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        New here?{" "}
        <Link className="text-foreground underline-offset-4 hover:underline" to="/signup">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}
