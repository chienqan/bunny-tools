import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import * as ignoreNs from 'ignore';

// `ignore` ships its callable factory as the default export on the namespace.
type IgnoreInstance = {
  add: (p: string[] | string) => IgnoreInstance;
  filter: (paths: string[]) => string[];
};
type IgnoreFactory = () => IgnoreInstance;
const ignore: IgnoreFactory =
  (ignoreNs as unknown as { default?: IgnoreFactory }).default ??
  (ignoreNs as unknown as IgnoreFactory);

export type WalkedFile = {
  /** Path relative to publicDir, forward-slash separated. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  size: number;
  mtimeMs: number;
};

export type WalkOptions = {
  publicDir: string;
  ignorePatterns?: string[];
  /** Hard cap on per-directory file count (Bunny: 10K). Warns when exceeded. */
  perDirCap?: number;
  onWarn?: (msg: string) => void;
};

export async function walkPublicDir(opts: WalkOptions): Promise<WalkedFile[]> {
  const root = resolve(opts.publicDir);
  const ig = ignore().add(opts.ignorePatterns ?? []);
  const cap = opts.perDirCap ?? 10_000;

  // tinyglobby skips unreadable directories instead of throwing, like the
  // previous fast-glob `suppressErrors` setting.
  const entries = await glob('**/*', {
    cwd: root,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    expandDirectories: false,
  });

  // Apply ignore (gitignore semantics) - ignore lib expects relative posix paths.
  const filtered = ig.filter(entries.map((p) => p.replace(/\\/g, '/')));

  const dirCounts = new Map<string, number>();
  const out: WalkedFile[] = [];
  for (const rel of filtered) {
    const absPath = resolve(root, rel);
    const s = await stat(absPath);
    out.push({
      path: rel,
      absPath,
      size: s.size,
      mtimeMs: s.mtimeMs,
    });
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  if (opts.onWarn) {
    for (const [dir, count] of dirCounts) {
      if (count > cap) {
        opts.onWarn(
          `Directory "${dir || '(root)'}" has ${count} files - Bunny recommends ≤${cap} per folder.`,
        );
      }
    }
  }

  return out;
}

export function relativeToPublic(publicDir: string, abs: string): string {
  return relative(resolve(publicDir), abs).replace(/\\/g, '/');
}
