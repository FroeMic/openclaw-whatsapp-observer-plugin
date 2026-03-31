export type OutputFormat = "json" | "table";

/**
 * Print results to stdout in the requested format.
 */
export function printOutput(
  data: unknown,
  format: OutputFormat,
  columns?: Array<{ key: string; header: string; width?: number }>,
): void {
  if (format === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }

  const cols = columns ?? inferColumns(data[0] as Record<string, unknown>);
  printTable(data as Array<Record<string, unknown>>, cols);
}

function inferColumns(
  sample: Record<string, unknown>,
): Array<{ key: string; header: string }> {
  return Object.keys(sample).map((key) => ({
    key,
    header: key.replace(/_/g, " "),
  }));
}

function printTable(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; header: string; width?: number }>,
): void {
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = formatCell(row[col.key]);
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.min(Math.max(headerLen, maxDataLen), 60);
  });

  const headerLine = columns.map((col, i) => col.header.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  process.stdout.write(headerLine + "\n");
  process.stdout.write(separator + "\n");

  for (const row of rows) {
    const line = columns
      .map((col, i) => formatCell(row[col.key]).slice(0, widths[i]).padEnd(widths[i]))
      .join("  ");
    process.stdout.write(line + "\n");
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && value > 1_000_000_000_000) {
    return new Date(value).toISOString();
  }
  return String(value);
}
