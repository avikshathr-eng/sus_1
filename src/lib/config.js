// Centralized so the support address only ever needs to change in one place
// (an env var), never hardcoded into a component or legal copy directly.
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com'
