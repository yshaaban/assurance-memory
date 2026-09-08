const acquire = (owner, generation) => ({ op: 'acquire', owner, generation });
const retain = (owner, delivery, packet) => ({ op: 'retain', owner, delivery, packet });
const deliver = delivery => ({ op: 'deliver', delivery });
const release = owner => ({ op: 'release', owner });
const ready = (owner, delivery) => [retain(owner, delivery, { kind: 'ready' }), deliver(delivery)];
const event = (owner, delivery, version, value, kind = 'event') => retain(owner, delivery, { kind, version, value });

/** Development examples, not an independent held-out detector benchmark. */
export const traces = {
  earlyRelease: { id: 'release-before-readiness', steps: [
    acquire('owner-a', 1), retain('owner-a', 'ready-a', { kind: 'ready' }),
    event('owner-a', 'queued-snapshot', 90, 'stale snapshot', 'snapshot'),
    release('owner-a'), deliver('ready-a'), deliver('queued-snapshot'),
  ] },
  lateRelease: { id: 'release-after-readiness', steps: [
    acquire('owner-a', 1), ...ready('owner-a', 'ready-a'),
    event('owner-a', 'before-release', 1, 'accepted current value'), deliver('before-release'),
    event('owner-a', 'queued-event', 90, 'stale event'), release('owner-a'), deliver('queued-event'),
  ] },
  replacement: { id: 'old-snapshot-before-replacement-traffic', steps: [
    acquire('owner-a', 1), ...ready('owner-a', 'ready-a'),
    event('owner-a', 'old-snapshot', 90, 'poisoned version', 'snapshot'), release('owner-a'),
    acquire('owner-b', 2), ...ready('owner-b', 'ready-b'), deliver('old-snapshot'),
    event('owner-b', 'current-event', 1, 'replacement accepted'), deliver('current-event'),
  ] },
  restart: { id: 'explicit-new-generation-same-owner', steps: [
    acquire('owner-a', 1), ...ready('owner-a', 'ready-a'),
    event('owner-a', 'old-event', 90, 'old generation'), release('owner-a'),
    acquire('owner-a', 2), ...ready('owner-a', 'ready-new'), deliver('old-event'),
    event('owner-a', 'current-event', 1, 'new generation accepted'), deliver('current-event'),
  ] },
  absorbing: { id: 'absorbing-owner-rejects-reacquisition', steps: [
    acquire('owner-a', 1), ...ready('owner-a', 'ready-a'),
    event('owner-a', 'old-event', 90, 'old generation'), release('owner-a'),
    acquire('owner-a', 2), deliver('old-event'),
  ] },
  beforeReady: { id: 'current-traffic-obeys-readiness-and-version', steps: [
    acquire('owner-a', 1), event('owner-a', 'early-event', 1, 'not ready'), deliver('early-event'),
    ...ready('owner-a', 'ready-a'), event('owner-a', 'current-event', 2, 'accepted'), deliver('current-event'),
    event('owner-a', 'old-version', 1, 'must be ignored'), deliver('old-version'), deliver('current-event'),
  ] },
};

export const cases = [
  ['unsafe', 'earlyRelease'], ['unsafe', 'lateRelease'], ['unsafe', 'replacement'],
  ['guarded', 'earlyRelease'], ['guarded', 'lateRelease'], ['guarded', 'replacement'],
  ['guarded', 'absorbing'], ['guarded', 'beforeReady'],
  ['restartable', 'earlyRelease'], ['restartable', 'lateRelease'],
  ['restartable', 'replacement'], ['restartable', 'restart'], ['restartable', 'beforeReady'],
];
