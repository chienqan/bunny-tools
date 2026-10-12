import type { ParsedInvocation } from '../../manifest/types.js';
import { listScripts } from '../../core/scripting.js';
import { printList } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listScripts(), {
    json: flags.json,
    empty: '(no edge scripts)',
    row: (s) => ({ id: s.Id, name: s.Name, type: s.ScriptType ?? '-', deployed: String(s.Deployed ?? false) }),
  });
  return 0;
}
