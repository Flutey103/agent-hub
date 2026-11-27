export function signInErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "Those credentials don't match. Check the email and password, or email yourself a sign-in link."
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email first. Check your inbox for the confirmation message, then sign in."
  }
  if (lower.includes("too many") || lower.includes("rate limit")) {
    return "Too many attempts. Wait a minute and try again."
  }
  return message
}

export function signUpErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  if (
    lower.includes("signups not allowed") ||
    lower.includes("signups are disabled") ||
    lower.includes("signup is disabled") ||
    (lower.includes("signup") && lower.includes("not allowed")) ||
    lower.includes("user not allowed")
  ) {
    return "Sign-ups are closed during early access. If you were invited, email yourself a sign-in link or reset your password. Ask the workspace owner if you still need an account."
  }
  if (lower.includes("already registered") || lower.includes("already been registered") || lower.includes("user already")) {
    return "An account with that email already exists. Sign in, or email yourself a sign-in link."
  }
  return message
}

export function magicLinkErrorMessage(message: string): string {
  const closed = signUpErrorMessage(message)
  if (closed !== message) return closed
  return signInErrorMessage(message)
}

export const checkEmailSignIn = (email: string) =>
  `Check your email. We sent a sign-in link to ${email}. Open it on this device.`

export const checkEmailReset = (email: string) =>
  `Check your email. We sent a link to set a new password to ${email}.`

export const checkEmailConfirm = (email: string) =>
  `Check your email. We sent a confirmation link to ${email}. After you confirm, sign in.`
