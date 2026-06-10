import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as readline from 'node:readline';

/**
 * Stream a JSONL file line by line, invoking the callback for every valid
 * object record. Malformed or empty lines are skipped — one broken record
 * must never break a scan.
 */
export async function readJsonlRecords(
  filePath: string,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<void> {
  let stream;
  try {
    await fs.access(filePath);
    stream = createReadStream(filePath, { encoding: 'utf8' });
  } catch {
    return;
  }

  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          onRecord(parsed as Record<string, unknown>);
        }
      } catch {
        // tolerate malformed lines
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}
