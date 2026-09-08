/** Deliberately unsafe: unsubscribe cannot revoke a callback already retained. */
export function createUnsafeOwner() {
  const owners = new Map();
  const cell = { generation: null, version: -1, value: null, mutations: 0 };
  return {
    acquire(id, generation) {
      if (owners.has(id)) return;
      owners.set(id, { generation, ready: false, subscribed: true });
      Object.assign(cell, { generation, version: -1, value: null, mutations: cell.mutations + 1 });
    },
    retain(id, packet) {
      const owner = owners.get(id);
      if (!owner?.subscribed) throw new Error('No live subscription');
      // Captured before cleanup; intentionally omits release/generation admission.
      return () => {
        if (packet.kind === 'ready') { owner.ready = true; return; }
        if (owner.ready && packet.version > cell.version)
          Object.assign(cell, { version: packet.version, value: packet.value, mutations: cell.mutations + 1 });
      };
    },
    release(id) { owners.get(id).subscribed = false; },
    snapshot() { return { ...cell }; },
  };
}
