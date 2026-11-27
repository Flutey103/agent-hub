import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { AuthProvider, useAuth } from "@/lib/auth"
import { useRealtime } from "@/lib/queries"
import { supabaseConfigured } from "@/lib/supabase"
import { WorkspaceProvider } from "@/lib/workspace"
import ActivityPage from "@/pages/Activity"
import AgentsPage from "@/pages/Agents"
import ForgotPasswordPage from "@/pages/ForgotPassword"
import HomePage from "@/pages/Home"
import InboxPage from "@/pages/Inbox"
import KnowledgePage from "@/pages/Knowledge"
import LandingPage from "@/pages/Landing"
import { LoadingScreen } from "@/pages/LoadingScreen"
import LoginPage from "@/pages/Login"
import NewTaskPage from "@/pages/NewTask"
import ResetPasswordPage from "@/pages/ResetPassword"
import SettingsPage from "@/pages/Settings"
import SignUpPage from "@/pages/SignUp"
import TaskDetailPage from "@/pages/TaskDetail"
import TasksPage from "@/pages/Tasks"
import WorkflowEditorPage from "@/pages/WorkflowEditor"
import WorkflowsPage from "@/pages/Workflows"

function appRoutes() {
  return (
    <>
      <Route path="home" element={<HomePage />} />
      <Route path="inbox" element={<InboxPage />} />
      <Route path="tasks/new" element={<NewTaskPage />} />
      <Route path="tasks/:id" element={<TaskDetailPage />} />
      <Route path="tasks" element={<TasksPage />} />
      <Route path="workflows/new" element={<WorkflowEditorPage />} />
      <Route path="workflows/:id" element={<WorkflowEditorPage />} />
      <Route path="workflows" element={<WorkflowsPage />} />
      <Route path="knowledge/facts" element={<KnowledgePage view="facts" />} />
      <Route path="knowledge" element={<KnowledgePage view="documents" />} />
      <Route path="agents" element={<AgentsPage />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </>
  )
}

function LandingGate() {
  const { ready, session, recovery } = useAuth()
  if (!ready) return <LoadingScreen />
  if (recovery) return <Navigate to="/reset-password" replace />
  if (session) return <Navigate to="/home" replace />
  return <LandingPage />
}

function RequireAuth() {
  const { ready, session, recovery } = useAuth()
  const location = useLocation()
  if (!ready) return <LoadingScreen />
  if (recovery) return <Navigate to="/reset-password" replace />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

function AuthedLayout() {
  const { session } = useAuth()
  if (!session) return null
  return (
    <WorkspaceProvider session={session}>
      <AuthedFrame />
    </WorkspaceProvider>
  )
}

function AuthedFrame() {
  useRealtime()
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function PreviewLayout() {
  return (
    <WorkspaceProvider demo>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  )
}

function ShellRoutes({ signedIn }: { signedIn: boolean }) {
  return (
    <Routes>
      <Route path="/" element={signedIn ? <LandingGate /> : <LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/preview" element={<PreviewLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        {appRoutes()}
        <Route path="*" element={<Navigate to="/preview/home" replace />} />
      </Route>
      <Route path="/artifacts" element={<Navigate to="/knowledge" replace />} />
      <Route path="/loops" element={<Navigate to="/workflows" replace />} />
      {signedIn ? (
        <Route element={<RequireAuth />}>
          <Route element={<AuthedLayout />}>
            {appRoutes()}
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  )
}

export default function App() {
  if (!supabaseConfigured) return <ShellRoutes signedIn={false} />
  return (
    <AuthProvider>
      <ShellRoutes signedIn />
    </AuthProvider>
  )
}
