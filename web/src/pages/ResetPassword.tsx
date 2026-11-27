import { useState, type FormEvent } from "react"
import { Link, Navigate } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"
import { supabase, supabaseConfigured } from "@/lib/supabase"
import { usePageTitle } from "@/lib/utils"
import { AuthLayout, Notice } from "./AuthLayout"
import { LoadingScreen } from "./LoadingScreen"

export default function ResetPasswordPage() {
  usePageTitle(`Set a new password — ${productName}`)
  if (!supabaseConfigured) return <ResetForm sessionReady={false} />
  return <ResetGate />
}

function ResetGate() {
  const auth = useAuth()
  if (!auth.ready) return <LoadingScreen />
  return <ResetForm sessionReady={Boolean(auth.session)} clearRecovery={auth.clearRecovery} />
}

function ResetForm({ sessionReady, clearRecovery }: { sessionReady: boolean; clearRecovery?: () => void }) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("Those passwords don't match.")
      return
    }
    if (!supabaseConfigured || !sessionReady) {
      setError("This link is invalid or has expired. Request a new one.")
      return
    }
    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    clearRecovery?.()
    setDone(true)
    setNotice("Password updated. You're signed in.")
  }

  if (done) return <Navigate to="/home" replace />

  return (
    <AuthLayout title="Set a new password" subtitle={sessionReady ? "Choose a password for this account." : "Open the link from your email. If it expired, request a new one."}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} />
        </Field>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" to="/forgot-password">
          Request a new link
        </Link>
      </p>
    </AuthLayout>
  )
}
