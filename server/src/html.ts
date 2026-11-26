/** Escape text that came from an OAuth client or another user before it is placed in HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
