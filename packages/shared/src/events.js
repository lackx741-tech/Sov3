import Redis from 'ioredis';

const TOPICS = {
  COMPILE_GENERATED: 'compile.generated',
  SCAN_INTEL: 'scan.intel',
  SCAN_COMPLETED: 'scan.completed',
  RELAY_CONFIRMED: 'relay.confirmed',
  RELAY_FAILURE: 'relay.failure',
  CAMPAIGN_DEPLOYED: 'campaign.deployed',
  RELAY_BROADCAST_REQUEST: 'relay.broadcast.request', // client-signed raw tx, user-authorized
  RELAY_RELAY_REQUEST: 'relay.relay.request', // operator-owned wallet broadcast request
};

class EventMesh {
  constructor(url) {
    this.pub = new Redis(url, { maxRetriesPerRequest: null });
    this.sub = new Redis(url, { maxRetriesPerRequest: null });
    this.localHandlers = new Map();
    this.subscribed = new Map(); // topic -> promise resolving when SUBSCRIBE is live
    // Attach the message listener exactly once. Attaching it per-subscribe-call
    // would invoke handlers twice for every published message.
    this.sub.on('message', (channel, message) => {
      const handlers = this.localHandlers.get(channel);
      if (!handlers) return;
      let data;
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }
      for (const h of handlers) h(data, channel);
    });
  }

  async publish(topic, payload) {
    await this.pub.publish(topic, JSON.stringify(payload));
  }

  subscribe(topic, handler) {
    if (!this.localHandlers.has(topic)) {
      this.localHandlers.set(topic, new Set());
    }
    const set = this.localHandlers.get(topic);
    set.add(handler);
    if (!this.subscribed.has(topic)) {
      this.subscribed.set(
        topic,
        new Promise((resolve, reject) => {
          this.sub.subscribe(topic, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
      );
    }
    return () => set.delete(handler);
  }

  // Resolve once all previously-registered topic subscriptions are live on Redis.
  // Callers that publish right after subscribing should await this to avoid the
  // pub/sub race where messages sent before SUBSCRIBE are dropped.
  async ensureSubscribed() {
    await Promise.all([...this.subscribed.values()]);
  }

  async close() {
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

export { EventMesh, TOPICS };