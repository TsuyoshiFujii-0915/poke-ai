/** Convert Showdown's KO chance text to the compact Japanese notation used by the UI. */
export function toJapaneseKoText(text: string): string {
  if (!text) return "-";
  if (/^guaranteed OHKO/.test(text)) return "確1";

  let match = text.match(/^guaranteed (\d)HKO/);
  if (match) return `確${match[1]}`;

  match = text.match(/^([\d.]+)% chance to OHKO/);
  if (match) return `乱1 (${match[1]}%)`;

  match = text.match(/^([\d.]+)% chance to (\d)HKO/);
  if (match) return `乱${match[2]} (${match[1]}%)`;

  match = text.match(/^possible (\d)HKO/);
  if (match) return `乱${match[1]}`;
  if (/^possible OHKO/.test(text)) return "乱1";
  return text;
}
