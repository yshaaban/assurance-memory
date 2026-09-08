import { createGuardedOwner } from './guarded.mjs';

/** Reusing an owner ID is deliberate, but old closures retain the old session. */
export function createRestartableOwner() {
  return createGuardedOwner({ restartable: true });
}
