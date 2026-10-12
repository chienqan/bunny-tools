// `bunny scripting deploy <name> --file <path>` - upsert by name: updates the
// script with that name if it exists, otherwise creates it.

import type { ParsedInvocation } from '../../manifest/types.js';
import { deployScript } from '../../core/scripting.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { name: string };
  const flags = inv.flags as { file?: string; type?: string; json?: boolean };
  if (!flags.file) {
    progress.fail('--file <path> is required, e.g. `bunny scripting deploy my-script --file ./build/index.js`.');
    return 1;
  }
  const result = await deployScript({
    name: args.name,
    filePath: flags.file,
    ...(flags.type ? { scriptType: Number.parseInt(flags.type, 10) } : {}),
  });
  reportDone(progress, flags.json, result, `Deployed edge script ${result.Name} (id=${result.Id}).`);
  return 0;
}
