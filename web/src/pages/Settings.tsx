import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { pricingEyebrow } from "@/config/pricing"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui-bits"
import { checkEmailReset, signInErrorMessage } from "@/lib/auth-copy"
import { useMembers } from "@/lib/queries"
import { supabase, supabaseConfigured } from "@/lib/supabase"
import { useTheme, type ThemeChoice } from "@/lib/theme"
import { usePageTitle } from "@/lib/utils"
import { usePreviewLock } from "@/lib/task-actions"
import { useWorkspace } from "@/lib/workspace"

export default function SettingsPage() {
  usePageTitle(`Settings — ${productName}`)
  const { workspace, email, userId, renameWorkspace, demo } = useWorkspace()
  const members = useMembers()
  const { theme, setTheme } = useTheme()
  const locked = usePreviewLock()
  const [name, setName] = useState(workspace.name)
  useEffect(() => {
    setName(workspace.name)
  }, [workspace.id, workspace.name])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetNote, setResetNote] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (demo) {
      await renameWorkspace(name)
      toast("Workspace renamed in the preview")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameWorkspace(name)
      toast("Workspace renamed")
    } catch (renameError) {
      setError((renameError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendReset() {
    if (!email || !supabaseConfigured) return
    if (locked("Sending a reset link")) return
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    if (resetError) setResetNote(signInErrorMessage(resetError.message))
    else setResetNote(checkEmailReset(email))
  }

  async function signOut() {
    if (!demo) await supabase.auth.signOut()
    window.location.assign("/")
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" description="This workspace, the people in it, and your account." />
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Workspace</h2>
        <p className="text-sm text-muted-foreground">
          {workspace.role} · {workspace.slug}
        </p>
        <form className="space-y-3" onSubmit={save}>
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save name"}
          </Button>
        </form>
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Members</h2>
        <p className="text-sm text-muted-foreground">Inviting people by email is not available yet. This is who already belongs to the workspace.</p>
        <ul className="space-y-2">
          {(members.data ?? []).map((member) => (
            <li key={member.user_id} className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm">
              <span className="min-w-0 truncate">{member.user_id === userId ? "You" : `Member ${member.user_id.slice(0, 8)}`}</span>
              <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Account</h2>
        <p className="text-sm">{email ?? "Signed in"}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => void sendReset()} disabled={!email || demo}>
            Email me a reset link
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
        {resetNote ? <p className="text-sm text-muted-foreground">{resetNote}</p> : null}
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Appearance</h2>
        <div className="grid grid-cols-3 gap-2">
          {(["light", "dark", "system"] as ThemeChoice[]).map((choice) => (
            <Button key={choice} variant={theme === choice ? "secondary" : "outline"} onClick={() => setTheme(choice)}>
              {choice[0].toUpperCase() + choice.slice(1)}
            </Button>
          ))}
        </div>
      </section>
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-medium">Billing</h2>
        <p className="text-sm text-muted-foreground">
          {pricingEyebrow}. Billing is not connected yet, so this workspace is not charged. Plans are listed on the public site and can change.
        </p>
      </section>
    </div>
  )
}
