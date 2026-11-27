import { Command } from "cmdk"
import { useQueryClient } from "@tanstack/react-query"
import { Moon, Sun } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { productName } from "../../../shared/brand"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/lib/theme"
import { usePaths, useWorkspace } from "@/lib/workspace"

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const paths = usePaths()
  const { workspaces, workspaceId, setWorkspaceId, demo, email } = useWorkspace()
  const { resolved, setTheme } = useTheme()
  const qc = useQueryClient()

  function go(to: string) {
    onOpenChange(false)
    navigate(to)
  }

  async function signOut() {
    onOpenChange(false)
    if (!demo) {
      qc.clear()
      await supabase.auth.signOut()
    }
    window.location.assign("/")
  }

  const jumps = [
    ["Home", paths.home],
    ["Inbox", paths.inbox],
    ["Tasks", paths.tasks],
    ["New task", paths.newTask],
    ["Workflows", paths.workflows],
    ["New workflow", paths.newWorkflow],
    ["Knowledge", paths.knowledge],
    ["Facts", paths.facts],
    ["Agents", paths.agents],
    ["Activity", paths.activity],
    ["Settings", paths.settings],
  ] as const

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Search ${productName}`} description="Jump to a page, create something, or switch workspace.">
      <Command label="Command menu" className="min-w-0">
        <Command.Input placeholder="Jump to, create, or switch workspace" autoFocus />
        <Command.List className="mt-2 max-h-[50vh] overflow-y-auto">
          <Command.Empty>Nothing matches.</Command.Empty>
          <Command.Group heading="Go to">
            {jumps.map(([label, to]) => (
              <Command.Item key={label} value={label} onSelect={() => go(to)}>
                {label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Workspace">
            {workspaces.map((workspace) => (
              <Command.Item
                key={workspace.id}
                value={`workspace ${workspace.name}`}
                onSelect={() => {
                  setWorkspaceId(workspace.id)
                  onOpenChange(false)
                  toast(`Switched to ${workspace.name}`)
                }}
              >
                {workspace.name}
                {workspace.id === workspaceId ? " · current" : ""}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Account">
            <Command.Item value="toggle theme" onSelect={() => setTheme(resolved === "dark" ? "light" : "dark")}>
              {resolved === "dark" ? <Sun /> : <Moon />} Toggle theme
            </Command.Item>
            <Command.Item value="sign out" onSelect={() => void signOut()}>
              Sign out{email ? ` ${email}` : ""}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </ResponsiveDialog>
  )
}
