export function effectiveRowsCreated(stats: {
  rowsCreated: number;
  cleanup?: { listRows?: number | null };
}): number {
  return stats.cleanup?.listRows == null
    ? stats.rowsCreated
    : Math.min(stats.rowsCreated, stats.cleanup.listRows);
}
