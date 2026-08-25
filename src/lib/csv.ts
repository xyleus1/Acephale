export function csvCell(value: string) {
  // Harvested text reaches this export unchanged, so a cell that a spreadsheet
  // would evaluate as a formula gets a literal apostrophe prefix.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const escaped = safe.replace(/"/g, '""');
  return /[",\n\r]/.test(safe) ? `"${escaped}"` : escaped;
}
