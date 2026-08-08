const PLACEHOLDER_EVIDENCE =
  /^(?:tbd|todo|pending|n\/a|na|not\s+run|not\s+promoted)$/i;

/** Returns true only for evidence references that are ready to be audited. */
export function isUsableEvidenceReference(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const reference = value.trim();
  if (!reference || PLACEHOLDER_EVIDENCE.test(reference)) return false;
  if (reference.includes('<') || reference.includes('>')) return false;
  return true;
}
