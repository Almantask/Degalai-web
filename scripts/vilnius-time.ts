/** Offset of Europe/Vilnius on a calendar day (`YYYY-MM-DD`), e.g. `+03:00`. */
export function vilniusOffsetAt(date: string): string {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Vilnius",
    timeZoneName: "longOffset",
  }).format(noonUtc);
  const m = formatted.match(/GMT([+-]\d{2}:\d{2})/i);
  return m?.[1] ?? "+03:00";
}

/** Interpret a naive Vilnius wall time as an ISO offset string. */
export function vilniusLocalToIso(naive: string): string | null {
  const m = naive.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return `${m[1]}T${m[2]}${vilniusOffsetAt(m[1])}`;
}
