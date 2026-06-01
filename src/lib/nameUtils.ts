const GENERIC_WORDS = new Set([
  "software", "solutions", "technologies", "tech", "systems", "services",
  "management", "consulting", "group", "company", "enterprises", "enterprise",
  "global", "international", "digital", "innovations", "innovation",
  "partners", "holdings", "properties", "property", "associates", "ventures",
  "pty", "ltd", "limited", "inc", "llc", "corp", "co", "and", "the",
]);

export function normaliseCompanyName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !GENERIC_WORDS.has(t));
  return tokens.join("");
}

export function companyNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normaliseCompanyName(a);
  const nb = normaliseCompanyName(b);
  if (!na || !nb) return false;

  if (na === nb) return true;

  // Substring containment — the shorter must be >= 4 chars to avoid
  // accidental matches on common short fragments ("co", "sys", etc.)
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length >= 4 && longer.includes(shorter)) return true;

  return false;
}
