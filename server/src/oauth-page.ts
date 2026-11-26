import { CAPABILITY_PRESETS } from "./capabilities.js";
import { escapeHtml } from "./html.js";

export interface ConsentView {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scope: string[];
  handle: string;
  email?: string | null;
  workspaces?: { id: string; name: string; role: string }[];
  agentName?: string;
  error?: string;
  mode: "login" | "approve";
}

const CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: #fafafa; color: #171717; font-family: ui-sans-serif, system-ui, sans-serif; }
  .card { width: 100%; max-width: 28rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
  h1 { font-size: 1.125rem; margin: 0 0 8px; }
  p, label { font-size: 0.875rem; line-height: 1.45; }
  .muted { color: #737373; }
  .warn { background: #fffbeb; color: #92400e; border-radius: 6px; padding: 8px 10px; }
  .error { color: #dc2626; }
  label { display: block; margin-top: 12px; }
  label span { display: block; margin-bottom: 4px; color: #737373; font-size: 0.75rem; }
  input, select { width: 100%; box-sizing: border-box; border: 1px solid #d4d4d4; background: #fff; color: inherit; border-radius: 6px; padding: 8px 12px; font: inherit; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { font: inherit; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  button.primary { background: #4f46e5; color: #fff; border: 1px solid #4f46e5; }
  button.ghost { background: #fff; border: 1px solid #d4d4d4; }
  code { font-size: 0.75rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f5f5f5; }
    .card { background: #171717; border-color: #262626; }
    .muted { color: #a3a3a3; }
    .warn { background: #451a03; color: #fde68a; }
    input, select, button.ghost { background: #171717; border-color: #404040; color: inherit; }
  }
`;

function clientBlurb(view: ConsentView): string {
  const name = escapeHtml(view.clientName);
  const origin = view.clientDomain
    ? `Published by <strong>${escapeHtml(view.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const loopback = view.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>`
    : "";
  const scopes = view.scope.length ? escapeHtml(view.scope.join(", ")) : "mcp";
  return `
    <h1>Allow ${name} to connect?</h1>
    <p>${origin} Access will be sent to <strong>${escapeHtml(view.redirectHost)}</strong>.</p>
    ${loopback}
    <p class="muted">Approving registers a new agent in the workspace you pick. Scope: ${scopes}.</p>
  `;
}

export function renderConsentPage(view: ConsentView): string {
  const error = view.error ? `<p class="error">${escapeHtml(view.error)}</p>` : "";
  const body =
    view.mode === "login"
      ? `
        ${clientBlurb(view)}
        <p class="muted">Sign in with your Agent Hub account to choose a workspace.</p>
        <form method="post">
          <input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
          <input type="hidden" name="action" value="login">
          <label><span>Email</span><input class="input" type="email" name="email" autocomplete="username" required></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          ${error}
          <div class="actions"><button class="primary" type="submit">Sign in</button></div>
        </form>`
      : `
        ${clientBlurb(view)}
        <p class="muted">Signed in as ${escapeHtml(view.email || "your account")}.</p>
        <form method="post">
          <input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
          <label><span>Workspace</span>
            <select name="workspace_id" required>
              ${(view.workspaces ?? [])
                .map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)} (${escapeHtml(workspace.role)})</option>`)
                .join("")}
            </select>
          </label>
          <label><span>Agent name</span><input name="agent_name" required maxlength="80" value="${escapeHtml(view.agentName || "")}"></label>
          <label><span>Capabilities</span>
            <select name="preset">
              ${CAPABILITY_PRESETS.map(
                (preset) =>
                  `<option value="${escapeHtml(preset.id)}"${preset.id === "all" ? " selected" : ""}>${escapeHtml(preset.label)} — ${escapeHtml(preset.description)}</option>`,
              ).join("")}
            </select>
          </label>
          ${error}
          <div class="actions">
            <button class="primary" type="submit" name="action" value="approve">Approve</button>
            <button class="ghost" type="submit" name="action" value="deny">Deny</button>
          </div>
        </form>`;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Connect an agent</title>
<style>${CSS}</style>
<body><main class="card">${body}</main></body>
</html>`;
}

export function renderMessagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
<body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}
