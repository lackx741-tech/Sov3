# AEGIS (Project)

A self-hosted web3 toolkit for teams that run their own decentralized application. It is a
set of small services that together let an operator:

1. Manage **wallet-connect** integrations for their **own domain**.
2. Configure **campaigns** (contract address, chain, transaction settings).
3. Generate an **embed script** that lets a visitor to a page the operator owns connect their
   wallet and, with their own explicit consent, send a transaction they can see and confirm in
   their wallet UI.
4. Relay those user-authorized transactions to the blockchain.
5. Monitor the whole system (scan results, relay confirmations, compile events, deployment
   status) through an **operator-only Telegram channel** or a web console.

## Privacy & safety model (the rules the code follows)

- The **operator's** API keys / credentials are stored encrypted in the backend database and
  never shipped to the browser.
- **Visitor keys never touch the backend.** Connecting users keep their private keys in their
  own wallet. The backend never requests, stores, or relays them.
- The embed script only runs on **domains the operator explicitly owns and whitelists**. There
  is no functionality for injecting the script into third-party sites, and no "target
  signature" harvesting. Each transaction a user signs is shown and confirmed by that user in
  their own wallet before broadcast.
- Transactions are broadcast normally to the chain the user chooses. No hidden private-mempool
  routing of third-party signatures.
- Telegram alerts describe the **operator's own service** (scanner results, relay
  confirmations, compile completions, deployment status). They do not act as a signal that a
  third-party wallet acted without its owner's consent.

## Architecture

| Service | Dir | Role |
|---|---|---|
| Shared | `packages/shared` | Event-mesh + shared helpers (ioredis pub/sub) |
| Orchestrator (C2) | `packages/orchestrator` | Express API: auth, campaigns, contracts, domains, API-key vault, rate limiting, compile trigger |
| Scanner | `packages/scanner` | Read chain state (balances, allowances, floor prices), cache in Redis, emit `scan.intel` |
| Relayer | `packages/relayer` | Build + sign + broadcast transactions, nonce mgmt, emit `relay.confirmed` / `relay.failure` |
| Compile | `packages/compile` | Generate wallet-connect embed scripts for the operator's own origin |
| Telegram (SIGINT) | `packages/telegram` | Operator monitoring alerts + status commands |
| Console | `packages/console` | React admin dashboard |

Data: PostgreSQL (relational: users, campaigns, contracts, domains, compile_logs, telegram_alerts,
api_keys) + Redis (cache, pub/sub, nonces).

## Run it

```bash
npm install
npm run db:up            # PostgreSQL 15 + Redis 7 via docker compose
npm run dev:orchestrator # etc. — see each package README
```

See `README.md` for the full operational spec (kept mostly for reference).