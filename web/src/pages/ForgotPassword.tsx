import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { checkEmailReset, signInErrorMessage } from "@/lib/auth-copy"
import { supabase, supabaseConfigured } from "@/lib/supabase"
import { usePageTitle } from "@/lib/utils"
import { AuthLayout, Notice } from "./AuthLayout"

export default function ForgotPasswordPage() {
  usePageTitle(`Reset password — ${productName}`)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!supabaseConfigured) {
      setError("This build has no sign-in service configured.")
      return
    }
    setBusy(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (resetError) setError(signInErrorMessage(resetError.message))
    else setNotice(checkEmailReset(email))
  }

  return (
    <AuthLayout title="Forgot password?" subtitle="We'll email you a link to set a new one.">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Sending…" : "Email me a reset link"}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" to="/login">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
