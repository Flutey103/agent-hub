import { useState, type FormEvent } from "react"
import { Link, Navigate } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { checkEmailConfirm, signUpErrorMessage } from "@/lib/auth-copy"
import { useAuth } from "@/lib/auth"
import { supabase, supabaseConfigured } from "@/lib/supabase"
import { usePageTitle } from "@/lib/utils"
import { AuthLayout, Notice } from "./AuthLayout"
import { LoadingScreen } from "./LoadingScreen"

export default function SignUpPage() {
  if (!supabaseConfigured) return <SignUpForm />
  return <SignUpGate />
}

function SignUpGate() {
  const { ready, session, recovery } = useAuth()
  if (!ready) return <LoadingScreen />
  if (recovery) return <Navigate to="/reset-password" replace />
  if (session) return <Navigate to="/home" replace />
  return <SignUpForm />
}

function SignUpForm() {
  usePageTitle(`Create an account — ${productName}`)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (password.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("Those passwords don't match.")
      return
    }
    if (!supabaseConfigured) {
      setError("This build has no sign-in service configured.")
      return
    }
    setBusy(true)
    const { data, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (signError) {
      setError(signUpErrorMessage(signError.message))
      return
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setNotice("If this email can register, you'll get a message shortly. If you already have an account, sign in or email yourself a link.")
      return
    }
    if (data.session) {
      window.location.assign("/home")
      return
    }
    setNotice(checkEmailConfirm(email))
  }

  return (
    <AuthLayout title="Create an account" subtitle="Early access may be closed. If it is, the form will say so.">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} />
        </Field>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="text-foreground underline-offset-4 hover:underline" to="/login">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
