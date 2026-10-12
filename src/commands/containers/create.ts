import type { ParsedInvocation } from '../../manifest/types.js';
import { createApp } from '../../core/containers.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { name: string };
  const flags = inv.flags as { image?: string; region?: string; port?: string; json?: boolean };
  const app = await createApp({
    name: args.name,
    ...(flags.image ? { image: flags.image } : {}),
    ...(flags.region ? { region: flags.region } : {}),
    ...(flags.port ? { port: Number.parseInt(flags.port, 10) } : {}),
  });
  reportDone(progress, flags.json, app, `Created container app ${app.Name} (id=${app.Id}).`);
  return 0;
}
