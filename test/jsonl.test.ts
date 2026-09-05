import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { MAX_JSON_RECORD_BYTES, readJsonlRecords } from '../src/sources/jsonl';

it('streams split UTF-8 records, malformed lines and the final unterminated line', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonl-'));
  const file = path.join(dir, 'log.jsonl');
  try {
    const expected = [{ value: 'ž'.repeat(70000) }, { value: 'last' }];
    await fs.writeFile(file, [JSON.stringify(expected[0]), '{bad', 'null', '[]', '', JSON.stringify(expected[1])].join('\r\n'));
    const records: unknown[] = [];
    await readJsonlRecords(file, (record) => records.push(record));
    expect(records).toEqual(expected);
    await expect(readJsonlRecords(path.join(dir, 'missing'), () => {})).resolves.toBeUndefined();
    await expect(readJsonlRecords(dir, () => {})).rejects.toThrow();
    await expect(readJsonlRecords(file, () => { throw new Error('callback failure'); })).rejects.toThrow('callback failure');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it('rejects oversized records with a bounded allocation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonl-bound-'));
  const file = path.join(dir, 'log.jsonl');
  try {
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i <= MAX_JSON_RECORD_BYTES / chunk.length; i++) await fs.appendFile(file, chunk);
    await expect(readJsonlRecords(file, () => {})).rejects.toThrow(RangeError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
