import fs from "node:fs";
import path from "node:path";
import type { ResultRow } from "../types.js";

const CSV_HEADER = "Scenario,Phase,Status,Details,Duration";
const BOM = "\uFEFF";

function escapeCsv(s: string): string {
  const clean = s.replace(/\r?\n/g, " ").trim();
  if (clean.includes(",") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

function rowToCsvLine(r: ResultRow): string {
  return [
    escapeCsv(r.scenario),
    escapeCsv(r.phase),
    r.status,
    escapeCsv(r.details),
    r.duration,
  ].join(",");
}

export class CsvWriter {
  private filePath: string;
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  append(row: ResultRow): void {
    if (!this.initialized) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, BOM + CSV_HEADER + "\n", "utf-8");
      this.initialized = true;
    }
    fs.appendFileSync(this.filePath, rowToCsvLine(row) + "\n", "utf-8");
  }

  get path(): string {
    return this.filePath;
  }
}
