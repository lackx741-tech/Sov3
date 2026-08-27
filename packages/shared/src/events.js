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
  }

  async publish(topic, payload) {
    await this.pub.publish(topic, JSON.stringify(payload));
  }

  subscribe(topic, handler) {
    if (!this.localHandlers.has(topic)) {
      this.localHandlers.set(topic, new Set());
      this.sub.subscribe(topic, (err) => {
        if (err) throw err;
      });
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
    const set = this.localHandlers.get(topic);
    set.add(handler);
    return () => set.delete(handler);
  }

  async close() {
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

export { EventMesh, TOPICS };