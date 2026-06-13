import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findJetBrainsCopilotDbs, parseJetBrainsUsage } from '../src/sources/jetbrainsSource';

let root: string;
let repo: string;

/** Write a fake Nitrite-like blob: binary noise interspersed with readable runs. */
async function fakeDb(dir: string, lines: string[]): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'copilot-agent-sessions-nitrite.db');
  const noise = Buffer.alloc(32); // sub-MIN_RUN binary separators
  const parts: Buffer[] = [];
  for (const line of lines) {
    parts.push(noise, Buffer.from(line, 'latin1'));
  }
  parts.push(noise);
  await fs.writeFile(file, Buffer.concat(parts));
  return file;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'jb-test-'));
  repo = path.join(root, 'work', 'new-automation');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });

  const lines: string[] = [];
  for (let i = 0; i < 20; i++) lines.push(`interactionId turnId responder ${repo}/src/Main.kt`);
  for (let i = 0; i < 8; i++) lines.push('model claude-opus-4.5 some chat content about refactoring code here');
  for (let i = 0; i < 2; i++) lines.push('model gpt-5.5 short follow-up question');
  await fakeDb(path.join(root, 'iu', 'chat-agent-sessions', '3Aa7BCoJPHio6DEz'), lines);

  await fakeDb(path.join(root, 'iu', 'chat-sessions', 'noModelsHere'), [
    'binary-ish text with no recognizable model ids at all',
  ]);
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('jetbrainsSource', () => {
  it('discovers nitrite dbs under each IDE session folder', async () => {
    const dbs = await findJetBrainsCopilotDbs(root);
    expect(dbs).toHaveLength(2);
  });

  it('extracts models, attributes the repo and estimates tokens', async () => {
    const dbs = await findJetBrainsCopilotDbs(root);
    const agent = dbs.find((d) => d.includes('chat-agent-sessions'))!;
    const usages = await parseJetBrainsUsage(agent, { charsPerToken: 4 });

    expect(usages.map((u) => u.model).sort()).toEqual(['claude-opus-4.5', 'gpt-5.5']);
    expect(usages.every((u) => u.estimated)).toBe(true);
    expect(usages.every((u) => u.provider === 'copilot')).toBe(true);
    expect(usages[0]!.folderPath).toBe(repo);
    // claude used 8× vs gpt 2× → larger estimated share
    const claude = usages.find((u) => u.model === 'claude-opus-4.5')!;
    const gpt = usages.find((u) => u.model === 'gpt-5.5')!;
    expect(claude.inputTokens).toBeGreaterThan(gpt.inputTokens);
    expect(claude.inputTokens + claude.outputTokens).toBeGreaterThan(0);
  });

  it('returns nothing when no models are present', async () => {
    const dbs = await findJetBrainsCopilotDbs(root);
    const empty = dbs.find((d) => d.includes('chat-sessions'))!;
    expect(await parseJetBrainsUsage(empty, { charsPerToken: 4 })).toEqual([]);
  });

  it('does not mistake binary noise like "o3" for a model', async () => {
    const dir = path.join(root, 'iu', 'chat-agent-sessions', 'noise');
    const file = await fakeDb(dir, [`junk o3 o7 prot ${repo}/x.kt`, 'model gpt-5-mini real model here']);
    const usages = await parseJetBrainsUsage(file, { charsPerToken: 4 });
    expect(usages.map((u) => u.model)).toEqual(['gpt-5-mini']);
  });
});
