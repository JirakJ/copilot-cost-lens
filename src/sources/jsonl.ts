import { createReadStream } from 'node:fs';

// ponytail: 64 MiB per record; stream individual fields if larger records become necessary.
export const MAX_JSON_RECORD_BYTES = 64 * 1024 * 1024;

/** Stream object records without retaining the whole log or unbounded lines. */
export async function readJsonlRecords(
  filePath: string,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  let pending = '';
  let pendingBytes = 0;
  const emit = () => {
    let record: unknown;
    try {
      record = JSON.parse(pending);
    } catch {
      return; // incomplete or malformed lines do not discard valid records
    }
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      onRecord(record as Record<string, unknown>);
    }
  };
  try {
    for await (const chunk of stream) {
      const text = String(chunk);
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const end = newline < 0 ? text.length : newline;
        const piece = text.slice(start, end);
        pendingBytes += Buffer.byteLength(piece, 'utf8');
        if (pendingBytes > MAX_JSON_RECORD_BYTES) {
          throw new RangeError('JSONL record exceeds the supported size');
        }
        pending += piece;
        if (newline < 0) break;
        emit();
        pending = '';
        pendingBytes = 0;
        start = newline + 1;
      }
    }
    if (pending.trim()) emit();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    stream.destroy();
  }
}
