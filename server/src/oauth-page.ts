import { productName } from "../../shared/brand.js";
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
  *, *::before, *::after { box-sizing: border-box; }
  :root { color-scheme: light dark; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: #fafafa; color: #18181b; font-family: ui-sans-serif, system-ui, sans-serif; }
  .card { width: 100%; max-width: 28rem; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 20px; }
  .brand { margin: 0 0 12px; font-size: 0.8125rem; font-weight: 600; }
  h1 { font-size: 1.25rem; line-height: 1.25; margin: 0 0 8px; overflow-wrap: anywhere; }
  p, label { font-size: 0.9375rem; line-height: 1.45; overflow-wrap: anywhere; }
  .muted { color: #71717a; }
  .warn { background: #fffbeb; color: #92400e; border-radius: 8px; padding: 10px 12px; }
  .error { color: #dc2626; }
  label { display: block; margin-top: 12px; }
  label span { display: block; margin-bottom: 6px; color: #71717a; font-size: 0.8125rem; }
  input, select { width: 100%; min-height: 44px; border: 1px solid #d4d4d8; background: #fff; color: inherit; border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 16px; }
  select { padding-right: 2rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
  button { font: inherit; font-size: 0.9375rem; border-radius: 8px; min-height: 44px; padding: 10px 14px; cursor: pointer; width: 100%; }
  button.primary { background: #18181b; color: #fafafa; border: 1px solid #18181b; }
  button.ghost { background: #fff; border: 1px solid #d4d4d8; color: inherit; }
  code { font-size: 0.75rem; overflow-wrap: anywhere; }
  @media (min-width: 480px) {
    .actions { flex-direction: row; }
    button { width: auto; }
  }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #fafafa; }
    .card { background: #18181b; border-color: #27272a; }
    .muted { color: #a1a1aa; }
    .warn { background: #451a03; color: #fde68a; }
    input, select, button.ghost { background: #09090b; border-color: #3f3f46; color: inherit; }
    button.primary { background: #fafafa; color: #18181b; border-color: #fafafa; }
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
        <p class="muted">Sign in with your ${escapeHtml(productName)} account to choose a workspace.</p>
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
                  `<option value="${escapeHtml(preset.id)}"${preset.id === "all" ? " selected" : ""}>${escapeHtml(preset.label)}</option>`,
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>Connect an agent · ${escapeHtml(productName)}</title>
<style>${CSS}</style>
<body><main class="card"><p class="brand">${escapeHtml(productName)}</p>${body}</main></body>
</html>`;
}

export function renderMessagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} · ${escapeHtml(productName)}</title>
<style>${CSS}</style>
<body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}
