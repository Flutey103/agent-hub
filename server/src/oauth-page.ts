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
  /** Set when a posted browser session was rejected, so the page does not submit it again. */
  sessionRejected?: "invalid" | "error";
}

/** Stable asset emitted by the web build. The worker HTML is no-store; this file is the session bridge. */
export const OAUTH_SESSION_SCRIPT = "/oauth-session.js";

const THEME_BOOT = `<script>
try {
  var stored = localStorage.getItem("agent-hub.theme");
  var dark = stored === "dark" || ((!stored || stored === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
</script>`;

const REVEAL_BOOT = `<script>
setTimeout(function () {
  var panel = document.getElementById("login-panel");
  var checking = document.getElementById("checking");
  if (!panel || !panel.hidden) return;
  panel.hidden = false;
  if (checking) checking.hidden = true;
}, 8000);
</script>`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: light;
    --background: oklch(0.99 0 0);
    --foreground: oklch(0.18 0 0);
    --primary: oklch(0.2 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.965 0 0);
    --muted-foreground: oklch(0.48 0 0);
    --destructive: oklch(0.55 0.2 25);
    --border: oklch(0.91 0 0);
    --input: oklch(0.91 0 0);
    --ring: oklch(0.55 0.03 250);
    --radius: 0.625rem;
  }
  :root.dark {
    color-scheme: dark;
    --background: oklch(0.16 0 0);
    --foreground: oklch(0.97 0 0);
    --primary: oklch(0.97 0 0);
    --primary-foreground: oklch(0.2 0 0);
    --muted: oklch(0.26 0 0);
    --muted-foreground: oklch(0.72 0 0);
    --destructive: oklch(0.7 0.16 22);
    --border: oklch(1 0 0 / 12%);
    --input: oklch(1 0 0 / 16%);
    --ring: oklch(0.7 0.03 250);
  }
  html, body { max-width: 100%; overflow-x: hidden; }
  body {
    margin: 0; min-height: 100vh; min-height: 100dvh;
    background: var(--background); color: var(--foreground);
    font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .top {
    display: flex; align-items: center;
    min-height: calc(3.5rem + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) max(1rem, env(safe-area-inset-right)) 0 max(1rem, env(safe-area-inset-left));
  }
  .brand { margin: 0; font-size: 0.875rem; font-weight: 600; }
  .wrap {
    width: 100%; max-width: 28rem; margin: 0 auto;
    padding: 0 max(1rem, env(safe-area-inset-right)) calc(4rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  }
  h1 { font-size: 1.25rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.015em; margin: 0 0 0.5rem; overflow-wrap: anywhere; }
  p, label { font-size: 0.875rem; line-height: 1.5; overflow-wrap: anywhere; }
  .muted { color: var(--muted-foreground); }
  .warn { background: #fffbeb; color: #92400e; border-radius: calc(var(--radius) - 2px); padding: 0.75rem; }
  :root.dark .warn { background: #451a03; color: #fde68a; }
  .error { color: var(--destructive); margin: 0.75rem 0 0; }
  .notice { margin: 0.75rem 0 0; border: 1px solid var(--border); background: var(--muted); border-radius: calc(var(--radius) - 2px); padding: 0.75rem; }
  label { display: block; margin-top: 0.75rem; }
  label span { display: block; margin-bottom: 0.375rem; font-size: 0.875rem; font-weight: 500; color: var(--foreground); }
  input, select {
    width: 100%; min-height: 44px; border: 1px solid var(--input); background: var(--background); color: inherit;
    border-radius: calc(var(--radius) - 2px); padding: 0.5rem 0.75rem; font: inherit; font-size: 16px;
  }
  select { padding-right: 2rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  input:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring); }
  .actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
  button {
    font: inherit; font-size: 0.875rem; font-weight: 500; border-radius: calc(var(--radius) - 2px);
    min-height: 44px; padding: 0.5rem 1rem; cursor: pointer; width: 100%; touch-action: manipulation;
  }
  button.primary { background: var(--primary); color: var(--primary-foreground); border: 1px solid var(--primary); }
  button.ghost { background: var(--background); border: 1px solid var(--input); color: inherit; }
  button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  #checking { margin-top: 1rem; }
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

function shell(title: string, body: string, options?: { mode?: string; sessionRejected?: string; sessionScript?: boolean; reveal?: boolean }): string {
  const rejected = options?.sessionRejected ? ` data-session-rejected="${escapeHtml(options.sessionRejected)}"` : "";
  const mode = options?.mode ? ` data-mode="${escapeHtml(options.mode)}"` : "";
  const scripts = options?.sessionScript
    ? `${options.reveal ? REVEAL_BOOT : ""}<script type="module" src="${OAUTH_SESSION_SCRIPT}"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · ${escapeHtml(productName)}</title>
${THEME_BOOT}
<style>${CSS}</style>
</head>
<body${mode}${rejected}>
<header class="top"><p class="brand">${escapeHtml(productName)}</p></header>
<main class="wrap">${body}</main>
${scripts}
</body>
</html>`;
}

export function renderConsentPage(view: ConsentView): string {
  const error = view.error ? `<p class="error" role="alert">${escapeHtml(view.error)}</p>` : "";
  if (view.mode === "login") {
    const showForm = Boolean(view.error || view.sessionRejected);
    const body = `
      ${clientBlurb(view)}
      <p id="checking" role="status"${showForm ? " hidden" : ""}>Checking your sign-in…</p>
      <div id="login-panel"${showForm ? "" : " hidden"}>
        <p class="muted">Sign in with your ${escapeHtml(productName)} account to choose a workspace. An email link works when the account has no password.</p>
        <form id="password-form" method="post">
          <input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
          <input type="hidden" name="action" value="login">
          <label><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          ${error}
          <div class="actions"><button class="primary" type="submit">Sign in</button></div>
        </form>
        <div class="actions"><button class="ghost" type="button" id="magic-link">Email me a sign-in link</button></div>
        <p id="magic-status" role="status"></p>
      </div>
      <form id="session-form" method="post" hidden>
        <input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
        <input type="hidden" name="action" value="session">
        <input type="hidden" name="access_token" value="" autocomplete="off">
      </form>
      <noscript><style>#checking{display:none!important}#login-panel{display:block!important}</style></noscript>`;
    return shell(`Connect an agent`, body, {
      mode: "login",
      sessionRejected: view.sessionRejected,
      sessionScript: true,
      reveal: !showForm,
    });
  }
  const body = `
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
  return shell("Connect an agent", body, { mode: "approve" });
}

export function renderMessagePage(title: string, message: string): string {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}
