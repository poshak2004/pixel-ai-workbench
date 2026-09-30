import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeBranch, GitService } from './service';

const git = new GitService();

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'pixel-git-'));
  await git.init(dir);
  await writeFile(join(dir, 'a.txt'), 'one\n');
  await git.checkpoint(dir, 'init');
  return dir;
}

describe('GitService — isolation and safety', () => {
  it('agents work in an isolated worktree; the user checkout is untouched', async () => {
    const dir = await repo();
    const wt = join(await mkdtemp(join(tmpdir(), 'pixel-wt-')), 'run_1');
    await git.createWorktree(dir, wt, 'pixel/run_1');
    await writeFile(join(wt, 'a.txt'), 'one\ntwo\n');
    await writeFile(join(wt, 'b.txt'), 'new\n');

    const stat = await git.diffStat(wt);
    expect(stat).toMatchObject({ filesChanged: 2, linesAdded: 2, linesRemoved: 0 });
    expect(await git.status(dir)).toEqual([]);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one\n');
    expect(await git.currentBranch(dir)).toBe('main');

    const sha = await git.checkpoint(wt, 'agent change');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.currentBranch(wt)).toBe('pixel/run_1');
    expect((await git.listWorktrees(dir)).map((w) => w.branch)).toContain('pixel/run_1');

    await git.removeWorktree(dir, wt, { deleteBranch: 'pixel/run_1' });
    expect((await git.listWorktrees(dir)).map((w) => w.branch)).not.toContain('pixel/run_1');
  });

  it('diffStat is read-only (does not stage anything)', async () => {
    const dir = await repo();
    await writeFile(join(dir, 'c.txt'), 'x\ny\n');
    await git.diffStat(dir);
    expect(await git.status(dir)).toEqual([{ index: '?', worktree: '?', path: 'c.txt' }]);
  });

  it('checkpoint → restore rolls back; revert creates an inverse commit', async () => {
    const dir = await repo();
    const base = await git.head(dir);
    await writeFile(join(dir, 'a.txt'), 'changed\n');
    const c1 = (await git.checkpoint(dir, 'change'))!;
    await git.restore(dir, base);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one\n');
    await git.restore(dir, c1);
    await git.revert(dir, c1);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one\n');
  });

  it('checkpoint with no changes returns null', async () => {
    expect(await git.checkpoint(await repo(), 'noop')).toBeNull();
  });

  it('rejects unsafe refs and commit ids', async () => {
    expect(() => assertSafeBranch('-x')).toThrow();
    expect(() => assertSafeBranch('a..b')).toThrow();
    expect(() => assertSafeBranch('pixel/run_1')).not.toThrow();
    await expect(git.restore(await repo(), 'HEAD; rm -rf /')).rejects.toThrow(/Invalid commit/);
  });
});
