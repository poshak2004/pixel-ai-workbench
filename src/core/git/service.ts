import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

export interface DiffStat {
  files: { path: string; added: number; removed: number }[];
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Git operations via the git CLI (argument arrays only — never a shell string).
 * Autonomous agents work in isolated worktrees on their own branch; the user's checkout is never
 * mutated by an agent.
 */
export class GitService {
  constructor(private readonly gitBinary = 'git') {}

  run(cwd: string, args: string[], opts: { signal?: AbortSignal; input?: string } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.gitBinary,
        args,
        {
          cwd,
          signal: opts.signal,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        },
        (err, stdout, stderr) => {
          if (err) reject(new GitError(`git ${args[0]} failed: ${stderr.trim() || err.message}`, stderr));
          else resolve(stdout);
        },
      );
      if (opts.input !== undefined) child.stdin?.end(opts.input);
    });
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      return (await this.run(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
    } catch {
      return false;
    }
  }

  async topLevel(dir: string): Promise<string> {
    return (await this.run(dir, ['rev-parse', '--show-toplevel'])).trim();
  }

  async currentBranch(dir: string): Promise<string> {
    return (await this.run(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  }

  async head(dir: string): Promise<string> {
    return (await this.run(dir, ['rev-parse', 'HEAD'])).trim();
  }

  async status(dir: string): Promise<GitStatusEntry[]> {
    const out = await this.run(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const entries: GitStatusEntry[] = [];
    const parts = out.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const index = p[0] ?? ' ';
      const worktree = p[1] ?? ' ';
      entries.push({ index, worktree, path: p.slice(3) });
      if (index === 'R' || index === 'C') i++; // skip rename source
    }
    return entries;
  }

  /** Diff of the working tree (including untracked files) against a base ref. Read-only: never touches the index. */
  async diffStat(dir: string, base = 'HEAD'): Promise<DiffStat> {
    const out = await this.run(dir, ['diff', '--numstat', base]);
    const files = out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [a, r, ...rest] = line.split('\t');
        return { path: rest.join('\t'), added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r) };
      });
    for (const path of await this.untracked(dir)) {
      const content = await readFile(join(dir, path), 'utf8').catch(() => '');
      files.push({ path, added: content ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0, removed: 0 });
    }
    return {
      files,
      filesChanged: files.length,
      linesAdded: files.reduce((n, f) => n + f.added, 0),
      linesRemoved: files.reduce((n, f) => n + f.removed, 0),
    };
  }

  async untracked(dir: string): Promise<string[]> {
    const out = await this.run(dir, ['ls-files', '--others', '--exclude-standard', '-z']);
    return out.split('\0').filter(Boolean);
  }

  async diff(dir: string, base = 'HEAD'): Promise<string> {
    const tracked = await this.run(dir, ['diff', base]);
    const extra: string[] = [];
    for (const path of await this.untracked(dir)) {
      const content = await readFile(join(dir, path), 'utf8').catch(() => '');
      extra.push(`new file: ${path}\n${content.split('\n').map((l) => `+${l}`).join('\n')}`);
    }
    return [tracked, ...extra].filter(Boolean).join('\n');
  }

  /** Create an isolated worktree on a new branch from `base`. */
  async createWorktree(repo: string, worktreePath: string, branch: string, base = 'HEAD'): Promise<void> {
    assertSafeBranch(branch);
    await mkdir(dirname(worktreePath), { recursive: true });
    await this.run(repo, ['worktree', 'add', '-b', branch, worktreePath, base]);
  }

  async removeWorktree(repo: string, worktreePath: string, opts: { deleteBranch?: string } = {}): Promise<void> {
    try {
      await this.run(repo, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      await rm(worktreePath, { recursive: true, force: true });
      await this.run(repo, ['worktree', 'prune']);
    }
    if (opts.deleteBranch) {
      assertSafeBranch(opts.deleteBranch);
      await this.run(repo, ['branch', '-D', opts.deleteBranch]).catch(() => undefined);
    }
  }

  async listWorktrees(repo: string): Promise<{ path: string; branch: string | null }[]> {
    const out = await this.run(repo, ['worktree', 'list', '--porcelain']);
    return out
      .split('\n\n')
      .filter(Boolean)
      .map((block) => {
        const lines = block.split('\n');
        const path = lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? '';
        const branch = lines.find((l) => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '') ?? null;
        return { path, branch };
      });
  }

  /** Commit everything in `dir` as a checkpoint. Returns the new commit sha, or null if nothing changed. */
  async checkpoint(dir: string, message: string): Promise<string | null> {
    await this.run(dir, ['add', '--all']);
    const staged = await this.run(dir, ['diff', '--cached', '--name-only']);
    if (!staged.trim()) return null;
    await this.run(dir, ['-c', 'user.name=PIXEL', '-c', 'user.email=agent@pixel.local', 'commit', '--no-verify', '-m', message]);
    return this.head(dir);
  }

  /** Roll a worktree back to a commit, discarding later changes (worktree-only operation). */
  async restore(dir: string, commit: string): Promise<void> {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new GitError(`Invalid commit ${commit}`);
    await this.run(dir, ['reset', '--hard', commit]);
    await this.run(dir, ['clean', '-fd']);
  }

  async revert(dir: string, commit: string): Promise<string> {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new GitError(`Invalid commit ${commit}`);
    await this.run(dir, ['-c', 'user.name=PIXEL', '-c', 'user.email=agent@pixel.local', 'revert', '--no-edit', commit]);
    return this.head(dir);
  }

  async init(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await this.run(dir, ['init', '-q', '-b', 'main']);
  }
}

export function assertSafeBranch(branch: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(branch) || branch.includes('..')) {
    throw new GitError(`Unsafe branch name: ${branch}`);
  }
}
