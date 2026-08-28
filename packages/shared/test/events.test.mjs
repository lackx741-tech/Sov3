import { describe, it, expect, afterAll } from 'vitest';
import { EventMesh, TOPICS } from '../src/events.js';

describe('TOPICS', () => {
  it('covers the full event surface', () => {
    expect(TOPICS).toMatchObject({
      COMPILE_GENERATED: 'compile.generated',
      SCAN_INTEL: 'scan.intel',
      SCAN_COMPLETED: 'scan.completed',
      RELAY_CONFIRMED: 'relay.confirmed',
      RELAY_FAILURE: 'relay.failure',
      RELAY_BROADCAST_REQUEST: 'relay.broadcast.request',
      RELAY_RELAY_REQUEST: 'relay.relay.request',
      CAMPAIGN_DEPLOYED: 'campaign.deployed',
    });
  });

  it('has unique topic strings', () => {
    const values = Object.values(TOPICS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// Talk-over-pubsub tests require a reachable Redis on the default URL. When one
// is unavailable (e.g. an offline unit-test run), the suite is skipped rather
// than failing the pipeline. The probe runs at module load (top-level await) so
// describe.skipIf sees it during collection instead of always skipping.
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let broker = null;
try {
  const probe = new EventMesh(REDIS_URL);
  await probe.ensureSubscribed();
  broker = probe;
} catch {
  broker = null;
}

afterAll(async () => {
  if (broker) await broker.close();
});

describe.skipIf(!broker)('EventMesh pub/sub', () => {
  it('delivers a published message to a single subscribed handler exactly once', async () => {
    const sub = new EventMesh(REDIS_URL);
    const unsub = sub.subscribe(TOPICS.RELAY_CONFIRMED, () => {});
    await sub.ensureSubscribed();

    const seen = [];
    const done = new Promise((resolve) => {
      sub.subscribe(TOPICS.RELAY_CONFIRMED, (p) => {
        seen.push(p);
        if (seen.length >= 1) setTimeout(resolve, 200); // allow a duplicate to land
      });
    });
    await sub.ensureSubscribed();

    await broker.publish(TOPICS.RELAY_CONFIRMED, { id: 'job-1', txHash: '0xabc' });
    await done;

    expect(seen.length).toBe(1); // regression guard: no double delivery
    expect(seen[0].txHash).toBe('0xabc');
    unsub();
    await sub.close();
  });

  it('dispatches to all handlers registered on a topic', async () => {
    const sub = new EventMesh(REDIS_URL);
    const received = [];
    sub.subscribe(TOPICS.COMPILE_GENERATED, (p) => received.push(`a:${p.campaignId}`));
    sub.subscribe(TOPICS.COMPILE_GENERATED, (p) => received.push(`b:${p.campaignId}`));
    await sub.ensureSubscribed();

    await broker.publish(TOPICS.COMPILE_GENERATED, { campaignId: 'cam-1' });
    await new Promise((r) => setTimeout(r, 300));

    expect(received.sort()).toEqual(['a:cam-1', 'b:cam-1']);
    await sub.close();
  });

  it('unsubscribe() stops future deliveries', async () => {
    const sub = new EventMesh(REDIS_URL);
    let count = 0;
    const unsub = sub.subscribe(TOPICS.SCAN_INTEL, () => count++);
    await sub.ensureSubscribed();

    await broker.publish(TOPICS.SCAN_INTEL, {});
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    await broker.publish(TOPICS.SCAN_INTEL, {});
    await new Promise((r) => setTimeout(r, 200));

    expect(count).toBe(1);
    await sub.close();
  });
});