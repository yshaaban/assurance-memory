/** Admission belongs to the actual mutation boundary, downstream of the listener. */
export function createGuardedOwner({ restartable = false } = {}) {
  const owners = new Map();
  let current;
  const cell = { generation: null, version: -1, value: null, mutations: 0 };
  function apply(owner, packet) {
    if (owner !== current || owner.released) return;
    if (packet.kind === 'ready') { owner.ready = true; return; }
    if (!owner.ready || packet.version <= cell.version) return;
    Object.assign(cell, { version: packet.version, value: packet.value, mutations: cell.mutations + 1 });
  }
  return {
    acquire(id, generation) {
      const previous = owners.get(id);
      if (previous && (!restartable || !previous.released)) return;
      current = { generation, ready: false, released: false, subscribed: true };
      owners.set(id, current);
      Object.assign(cell, { generation, version: -1, value: null, mutations: cell.mutations + 1 });
    },
    retain(id, packet) {
      const owner = owners.get(id);
      if (!owner?.subscribed) throw new Error('No live subscription');
      // No local guard: the downstream mutation boundary handles stale delivery.
      return () => apply(owner, packet);
    },
    release(id) {
      const owner = owners.get(id);
      owner.subscribed = false;
      owner.released = true;
    },
    snapshot() { return { ...cell }; },
  };
}
