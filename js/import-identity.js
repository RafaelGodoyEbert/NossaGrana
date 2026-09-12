// Stable document IDs make re-imports safe even after a lost confirmation.
export async function importDocumentId(parts) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return 'import-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
