/** Opaque random identifier for editable create-form defaults; DB uniqueness remains authoritative. */
export function generateEntityCode(prefix: 'CAMP'|'INST'|'GRP'|'STU'|'R'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + '-' + Array.from(bytes,b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
}
