import { createUnsafeOwner } from './unsafe.mjs';
import { createGuardedOwner } from './guarded.mjs';
import { createRestartableOwner } from './restartable.mjs';

// Only these checked-in public synthetic modules can be selected by the lab CLI.
// The adapter performs no lifecycle filtering and does not contain the oracle.
export const adapters = {
  unsafe: { id: 'synthetic-unsafe/1', sourcePath: 'examples/lifecycle-lab/adapter.mjs', create: createUnsafeOwner },
  guarded: { id: 'synthetic-guarded/1', sourcePath: 'examples/lifecycle-lab/adapter.mjs', create: createGuardedOwner },
  restartable: { id: 'synthetic-restartable/1', sourcePath: 'examples/lifecycle-lab/adapter.mjs', create: createRestartableOwner },
};
