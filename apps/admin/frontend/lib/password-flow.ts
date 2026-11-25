/**
 * Sprint 6 EP-20 (S6-B6, CO-77): the three public pages of the console: forgot password, reset password and accept an invitation. Pure helpers: which
 * endpoint a page posts to, what it sends, what is checked first, and the words of the answer. The server decides; this only follows.
 */

export type PasswordFlow = "forgot" | "reset" | "invite";

export const FLOW_ENDPOINTS: Record<PasswordFlow, string> = { forgot: "/api/password/forgot", reset: "/api/password/reset", invite: "/api/invite/accept" };

export const FLOW_COPY: Record<PasswordFlow, { title: string; hint: string; button: string; done: string }> = {
  forgot: { title: "Forgot your password?", hint: "Enter the email of your admin account. If it exists, we send a link that works once for 30 minutes.", button: "Send the link", done: "If that email has an admin account, a link is on its way." },
  reset: { title: "Choose a new password", hint: "This ends every other session of your account.", button: "Save the password", done: "Your password was changed. Sign in with it." },
  invite: { title: "Welcome: set your password", hint: "You were invited to the console. Choose a password to finish.", button: "Set the password", done: "Your account is ready. Sign in." },
};

export interface FlowForm {
  email: string;
  password: string;
  confirm: string;
}
export type FlowProblems = Partial<Record<"email" | "password" | "confirm" | "token", string>>;

/** A token from the link: 16 to 200 URL-safe characters. Anything else is "this link is not complete", before any request. */
export const tokenShape = (token: string | null): token is string => token !== null && /^[A-Za-z0-9_-]{16,200}$/.test(token);

export function flowProblems(flow: PasswordFlow, form: FlowForm, token: string | null): FlowProblems {
  const problems: FlowProblems = {};
  if (flow === "forgot") {
    if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(form.email.trim()) || form.email.length > 254) problems.email = "Enter a valid email address.";
    return problems;
  }
  if (!tokenShape(token)) problems.token = "This link is not complete. Open it again from the email, or ask for a new one.";
  if (form.password.length < 8) problems.password = "The password must be at least 8 characters.";
  else if (form.password.length > 200) problems.password = "The password is too long.";
  else if (form.password !== form.confirm) problems.confirm = "The two passwords are not the same.";
  return problems;
}

/** What the page posts. The confirmation never leaves the browser. */
export function flowBody(flow: PasswordFlow, form: FlowForm, token: string | null): Record<string, string> {
  return flow === "forgot" ? { email: form.email.trim().toLowerCase() } : { token: token ?? "", password: form.password };
}

export interface FlowAnswer {
  ok: boolean;
  message: string;
  field: string | null;
}

/** The words of a response: success is the page's own text; a failure keeps the server's message and the field it is about. */
export async function readFlowAnswer(flow: PasswordFlow, response: Response): Promise<FlowAnswer> {
  if (response.ok) return { ok: true, message: FLOW_COPY[flow].done, field: null };
  const body = (await response.json().catch(() => null)) as { error?: unknown; field?: unknown } | null;
  const retry = response.status === 429 ? " Wait a little and try again." : "";
  return { ok: false, message: (typeof body?.error === "string" ? body.error : "Something went wrong. Try again.") + (typeof body?.error === "string" && retry !== "" && !body.error.includes("wait") ? retry : ""), field: typeof body?.field === "string" ? body.field : null };
}
