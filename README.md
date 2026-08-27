> **// TOP SECRET // PROJECT AEGIS-VOID // FULL BUILDING SPECIFICATION // EYES ONLY //**
> **// DO NOT DISSEMINATE OUTSIDE THEATER COMMAND //**
> **// CLASSIFICATION: OMEGA / BLACK-SITE / NEUROMORPHIC CLEARANCE REQUIRED //**

---

## I. EXECUTION SUMMARY / THEATER OVERVIEW

**OPERATION DARK LEDGER** is a **void-tethered, distributed event-driven microservices architecture** designed for high-velocity blockchain campaign deployment, chain-state intelligence gathering, and kinetic transaction broadcasting in hostile mempool environments. This is **not** a monolithic leviathan. It is a **decoupled battalion of autonomous combat units** communicating over a hardened event-mesh, governed by a central C2 node, and weaponized through a **Tactical Compile Array** that generates embedded deployment packets for external theater integration.

**The End-State:** A web-administered **Compile Dashboard** allowing a field operator to:
1. Lock a **Target Contract Signature**;
2. Configure the **Kinetic Payload Engine**;
3. Design the **Tactical Overlay Modal** (UI artifact);
4. Select an **Identity Anchor Protocol** (Reown / WalletConnect v2 / RainbowKit);
5. **Bundle and Forge** an inline script for direct embedding into any enemy (or allied) website;
6. Register to a **Battlefield Domain**; and
7. Monitor via **Signal Intelligence (SIGINT)** over Telegram.

---

## II. ARCHITECTURAL DOCTRINE (THE NON-MONOLITHIC MANDATE)

| Doctrine | Specification |
|---|---|
| **Paradigm** | Distributed **Event-Driven Microservices** |
| **Topology** | Decentralized combat units with a central command backbone |
| **Communication** | Asynchronous **Event Mesh** (Redis Streams / NATS / Kafka) |
| **Failure Mode** | Unit-level isolation; no single point of catastrophic failure |
| **Deployment Theater** | Kubernetes / Docker Swarm / Bare-Metal Cluster |
| **Security Posture** | Zero-Trust / HSM-locked keys / Encrypted data links |

---

## III. COMMAND STRUCTURE — THE BATTALION BREAKDOWN

### 3.1. TACTICAL COMMAND INTERFACE (FRONTEND)
**Designation:** `AEGIS-CONSOLE-01`
**Module:** React 18+ + TypeScript 5+
**Role:** The administrative command console for campaign configuration, visual intelligence, and the **Compile Array interface**.

| Spec | Detail |
|---|---|
| **Framework** | React (Functional Components + Hooks) |
| **Language** | TypeScript (Strict Mode Enabled) |
| **State Management** | Redux Toolkit / Zustand / React Query (Cache invalidation for chain data) |
| **Build Engine** | Vite / Webpack 5 |
| **Styling** | Tailwind CSS / CSS Modules / ShadCN-style design system |
| **Wallet Integration (Compile)** | Modular SDK injection for **Reown (WalletConnect v2)**, **RainbowKit**, or raw **WalletConnect v2** |
| **Security** | CSP Headers, XSS Sanitization, Domain-whitelist validation for compiled scripts |
| **Operational Mode** | Admin console; Compile Dashboard embedded as primary interface module |

**Critical Function:** The Compile Array is *not* an external tool; it is a **native module** of this console.

---

### 3.2. CENTRAL COMMAND / C2 NODE (ORCHESTRATOR)
**Designation:** `AEGIS-ORCH-01`
**Module:** Node.js 20+ + Express 4
**Role:** Manages deployments, API key vaults, user session tokens, and routes all inter-service orders.

| Spec | Detail |
|---|---|
| **Runtime** | Node.js LTS (V8 Engine) |
| **Framework** | Express with `helmet`, `cors`, `express-rate-limit`, `compression` |
| **Auth Protocol** | JWT (Access + Refresh) / OAuth2 / Session-based command |
| **Key Vault** | API Keys encrypted at rest (AES-256 / AWS KMS / Azure Key Vault) |
| **Deployment Mgmt** | Campaign lifecycle orchestration (Draft → Forge → Deploy → Monitor) |
| **API Gateway** | Rate-limited endpoints for Scanner / Relayer / Compile requests |
| **Event Publishing** | Publishes command events to Mesh (`campaign.deployed`, `scan.completed`, `relay.broadcast`) |

---

### 3.3. INTELLIGENCE & RECON DIVISION (SCANNER)
**Designation:** `AEGIS-SCAN-01`
**Module:** Microservice — `web3.js`
**Role:** Reads chain states: balances, allowances, NFT floor prices, contract states.

| Spec | Detail |
|---|---|
| **Tech Stack** | Node.js microservice; `web3.js` v4 |
| **Chain Endpoints** | JSON-RPC (Local / Alchemy / Infura / QuickNode) |
| **Scan Targets** | Wallet balances; Token allowances (`approve` mappings); NFT floor prices (Marketplace aggregators); Contract ABI state |
| **Cache Strategy** | Writes hot intelligence to **Redis** (TTL-based: 15s–5m depending on volatility) |
| **Output** | Structured JSON payloads to Event Mesh (`scan.intel`) |
| **Operational Security** | Read-only keys; no private material stored |

**Data Flow:** Scanner pulls raw chain state → normalizes → caches in Redis → publishes `scan.intel` to Mesh → C2 Node updates Console.

---

### 3.4. KINETIC STRIKE DIVISION (RELAYER)
**Designation:** `AEGIS-RELAY-01`
**Module:** Microservice — Transaction Forge & Broadcast
**Role:** Constructs, signs, and broadcasts transactions via **Flashbots** or **Private Mempools**.

| Spec | Detail |
|---|---|
| **Tech Stack** | Node.js; `ethers.js` / `web3.js` signing; `@flashbots/mev-share-client` / custom private RPC |
| **Signing Architecture** | Isolated signing environment; keys loaded via **Environment / HSM / AWS KMS** (never in source) |
| **Broadcast Protocol** | **Flashbots Protect** / **MEV-Share** / Direct Private Mempool RPC (bypass public mempool) |
| **Transaction Types** | Contract interaction, Token transfer, NFT execution, Batch multicall |
| **Nonce Management** | Reads current nonce from Redis / chain state; increments atomically to prevent replay |
| **Confirmation** | Listens for tx receipt; publishes `relay.broadcast` (success) or `relay.failure` (revert / drop) |
| **Fail-Safe** | Gas price oracle integration; max fee caps; timeout killswitch |

**Critical:** This is the **kinetic arm**. It touches private keys. It is air-gapped from the frontend.

---

### 3.5. STRATEGIC DATA CORE (DATABASE LAYER)
**Designation:** `AEGIS-DATA-01`

| Component | Spec | Function |
|---|---|---|
| **PostgreSQL 15+** | Primary Relational Core | Campaigns, users, audit logs, contract metadata, domain mappings, compile history, Telegram alert logs |
| **Redis 7+** | Hot Cache / Memory Core | Asset prices (NFT floors, token balances), nonces, session states, event bus pub/sub, temporary compile artifacts |

**Data Integrity:** ACID for relational; eventual consistency for cache; periodic sync from Redis to PostgreSQL for audit.

---

### 3.6. NEURAL MESH (EVENT BACKBONE)
**Designation:** `AEGIS-MESH-01`
**Module:** Event Bus (NATS Streaming / Redis PubSub / Apache Kafka)

All units communicate asynchronously.
- **C2 Node** publishes `command.execute`
- **Scanner** publishes `scan.completed`
- **Relayer** publishes `relay.confirmed`
- **Compile Array** publishes `compile.generated`

No direct HTTP chaining between Scanner and Relayer. **Event-driven only.**

---

## IV. TACTICAL COMPILE ARRAY (THE DASHBOARD)
**Designation:** `AEGIS-COMPILE-01`

This is the **primary user-facing weapon system** requested. It is a multi-module forge embedded in the Frontend, backed by the C2 Node, and producing **Inline Script Deployment Packets**.

### 4.1. Array Architecture

```
[SELECT CONTRACT] → [TRANSACTION ENGINE CONFIG] → [MODAL OVERLAY DESIGN] → [IDENTITY ANCHOR SELECT] → [BUNDLE FORGE] → [INLINE SCRIPT OUTPUT] → [DOMAIN REGISTRY / TELEGRAM ALERT]
```

### 4.2. Module: Contract Acquisition / Target Lock
- **Function:** Select contract from a registry or input address manually.
- **Data:** Contract ABI (fetched or pasted), Contract Address, Chain ID.
- **Engine Link:** The selected contract defines the **Transaction Engine** methods (function signatures, parameter types, gas estimates).

### 4.3. Module: Transaction Engine (Kinetic Payload Forge)
- **Function:** Configure what the button/inline script executes when triggered.
- **Parameters:**
  - Function name (e.g., `mint`, `approve`, `executeCampaign`)
  - Arguments (static, dynamic, or wallet-derived)
  - Chain network (Ethereum, Polygon, Base, etc.)
  - Gas policy (Auto / Manual / Flashbots preference)
- **Output:** A JSON payload of transaction parameters.

### 4.4. Module: Tactical Overlay / Modal Configuration
- **Function:** Design the modal interface that appears upon wallet connection / transaction initiation.
- **Configurable Elements:**
  - Modal Type / Behavior (Confirmation, Signature Request, Execution Status, Error Alert)
  - Visual Theme (Dark Ops / Militant / Minimal / Custom Brand)
  - Text / Localization strings
  - Trigger event (On click, on wallet connect, on chain change)
- **Artifact:** A configuration object embedded into the bundle.

### 4.5. Module: Identity Anchor Protocol Selection (Wallet Connect)
The operator selects which **neural-link technology** powers the wallet connection in the generated script.

| Protocol | Designation | Spec |
|---|---|---|
| **Reown / WalletConnect v2** | `PROTOCOL-REOWN` | Reown SDK / WalletConnect v2.0 relay; universal wallet support; push notifications via relay |
| **WalletConnect v2 (Raw)** | `PROTOCOL-WCV2` | Direct `@walletconnect/ethereum-provider`; lower-level control; custom pairing |
| **RainbowKit** | `PROTOCOL-RAINBOW` | RainbowKit integration for React apps; checkboxes for supported wallets; theme config; `wagmi` dependency |

**Bundle Impact:** The selected protocol determines which SDK imports, initialization code, and event listeners (`connect`, `disconnect`, `chainChange`) are injected into the inline script.

### 4.6. Module: Bundle Forge & Inline Script Generation
**Function:** Compiles all configurations into a single deployable artifact.

**Bundle Contents (The Inline Script Packet):**
1. **HTML/JS Wrapper:** `<script src="..." type="module">` or inline `<script>` block.
2. **Protocol SDK Import:** Dynamic or static import of Reown / WCv2 / RainbowKit / Wagmi.
3. **Contract Interface:** ABI + Address embedded (or fetched from your API endpoint).
4. **Modal Component:** React/Vue/Vanilla JS modal logic (or reference to your hosted modal endpoint).
5. **Event Listeners:** `onConnect`, `onDisconnect`, `onChainChange`.
6. **Transaction Initiator:** Function that constructs and sends the kinetic payload via the selected wallet.
7. **Telegram Webhook / Alert Trigger:** Code block notifying your Telegram SIGINT array on completion.
8. **Domain Lock:** Validation to ensure script only executes on whitelisted domains.

**Output:** A ready-to-paste inline script block, or a URL to a hosted bundle endpoint (`https://your-c2-node.com/bundles/campaign-001.js`).

**Deployment Method:** The operator copies the inline script or integrates the npm module into their external site.

### 4.7. Module: Domain Registry
- **Function:** Assign and validate domains for each compiled bundle.
- **Spec:** Domain whitelisting per campaign; CORS policies; script origin validation.
- **Integration:** Each compile session ties to a domain entry in PostgreSQL.

---

## V. COMMUNICATIONS NETWORK — TELEGRAM & ALERTS
**Designation:** `AEGIS-SIGINT-01`

The architecture includes a **dual-purpose Telegram integration**: **Alert Reception** and **Remote Command / Compile Interface**.

### 5.1. Telegram Alert Intelligence (SIGINT)
| Alert Class | Trigger | Content |
|---|---|---|
| **ALPHA** | Scanner detects chain state anomaly (price crash, allowance change) | Balance / floor price alert + contract address |
| **BRAVO** | Relayer broadcasts / fails | Tx hash / failure reason / gas used / block number |
| **CHARLIE** | Compile Array completes / Script generated | Campaign ID + Domain + Protocol used + Download link |
| **DELTA** | Wallet connection failure / Identity Anchor error | Error code + User attempt log |
| **ECHO** | Campaign deployed / Campaign started | Deployment confirmation + domain link |

**Mechanism:** C2 Node holds Telegram Bot Token; publishes to Channel/Group via Bot API; supports inline keyboard commands.

### 5.2. Telegram Compile / Remote Command Interface
The user can initiate or trigger compile actions via Telegram:
- `/compile <campaign_id>` → Triggers C2 to generate bundle (if pre-configured).
- `/status <campaign_id>` → Returns deployment and relay status.
- `/alerts on/off` → Toggle SIGINT classes.

This transforms Telegram into a **remote command terminal** for campaign management.

---

## VI. OPERATIONAL PARAMETERS — FULL TECH STACK MATRIX

| Layer | Designation | Technology / Protocol |
|---|---|---|
| **Frontend** | `AEGIS-CONSOLE-01` | React 18 + TypeScript 5 + Vite + Tailwind + ShadCN / Radix |
| **Wallet SDK** | `WALLET-ARMORY` | Reown SDK / `@walletconnect/ethereum-provider` / RainbowKit + Wagmi |
| **Orchestrator** | `AEGIS-ORCH-01` | Node.js 20 + Express 4 + JWT + Helmet + Rate-Limit |
| **Event Mesh** | `AEGIS-MESH-01` | Redis Pub/Sub / NATS / Kafka (recommended for multi-zone) |
| **Scanner** | `AEGIS-SCAN-01` | Node.js microservice + `web3.js` v4 + JSON-RPC endpoints |
| **Relayer** | `AEGIS-RELAY-01` | Node.js microservice + `ethers.js` v6 + Flashbots / MEV-Share / Private RPC |
| **Database** | `AEGIS-DATA-01` | PostgreSQL 15 (primary) + Redis 7 (cache / nonce / pubsub) |
| **Compile Engine** | `AEGIS-COMPILE-01` | Node.js module (backend forge) + React module (frontend array) |
| **Deployment** | `AEGIS-DEPLOY` | Docker / Kubernetes / Helm Charts / GitOps (ArgoCD) |
| **Telecom** | `AEGIS-SIGINT-01` | Telegram Bot API (HTTP) + Webhook / Polling |
| **Security** | `AEGIS-SHIELD` | TLS 1.3, AES-256 encryption at rest, HSM/KMS for keys, Zero-Trust Network |

---

## VII. SECURITY & COUNTERMEASURES (BATTLE HARDENING)

| Threat | Countermeasure |
|---|---|
| **Private Key Exposure** | Relayer keys in HSM / KMS; never touch frontend; isolated microservice |
| **Mempool Front-Running** | Flashbots / Private mempool only; no public mempool broadcasts |
| **Script Injection / XSS** | Domain-lock on inline scripts; CSP; sandboxed iframes optional |
| **API Key Theft** | Encrypted vault; rotate via C2; rate-limit all endpoints |
| **Nonce Collisions** | Atomic nonce retrieval via Redis; sequential transaction queuing |
| **Replay Attacks** | Chain-specific transaction signatures; unique nonces per chain |
| **Telegram Bot Hijack** | Secure token storage; restricted bot permissions; command authorization |

---

## VIII. DEPLOYMENT BATTLE PLAN

```
STAGE 1: INFRASTRUCTURE         → Provision Kubernetes / Docker cluster; PostgreSQL + Redis clusters.
STAGE 2: C2 NODE                → Deploy `AEGIS-ORCH-01`; establish API keys; auth systems.
STAGE 3: DATABASE               → Initialize schemas (users, campaigns, contracts, domains, compile logs).
STAGE 4: MESH / EVENT BUS      → Launch NATS / Kafka / Redis PubSub backbone.
STAGE 5: SCANNER DIVISION      → Deploy `AEGIS-SCAN-01`; configure JSON-RPC endpoints; test web3.js reads.
STAGE 6: RELAYER DIVISION      → Deploy `AEGIS-RELAY-01`; configure Flashbots; load HSM keys; test broadcast.
STAGE 7: FRONTEND / CONSOLE    → Deploy React console; mount Compile Array module.
STAGE 8: TELEGRAM SIGINT       → Configure Bot; link webhook; establish alert channels.
STAGE 9: COMPILE TESTING       → Forge test bundles (Reown / RainbowKit / WCv2); embed; verify domain execution.
STAGE 10: FULL THEATER         → Scale Scanner/Relayer based on chain congestion; activate monitoring.
```

---

## IX. FINAL SPECIFICATION CHECKLIST (MISSION CRITICAL)

- [x] **Distributed Event-Driven Microservices** (Not monolithic)
- [x] **Frontend:** React + TypeScript (Admin Console + Compile Dashboard)
- [x] **Backend Orchestrator:** Node.js + Express (Deployments, API Keys, Sessions)
- [x] **Scanner Microservice:** `web3.js` (Balances, Allowances, NFT Floor Prices)
- [x] **Relayer Microservice:** Constructs/Signs/Broadcasts (Flashbots / Private Mempools)
- [x] **Database Layer:** PostgreSQL (Relational) + Redis (Asset Prices / Nonces / Cache)
- [x] **Compile Dashboard:** Select Contract → Transaction Engine → Modal Config → Wallet Connect (Reown / WalletConnect v2 / RainbowKit) → Bundle → Inline Script
- [x] **Inline Script Generation:** Copy-paste / module for website wallet connect button
- [x] **Domain Registry:** Integration per compiled bundle / campaign
- [x] **Telegram Integration:** Alert reception + Remote compile / status commands
- [x] **Military Sci-Fi Architecture:** Named divisions, HSM security, event-mesh, kinetic payload terminology

---

**// END SPECIFICATION //**
**// PROJECT AEGIS-VOID IS READY FOR THEATER DEPLOYMENT //**
**// CEASE TRANSMISSION / AWAIT AUTHENTICATION //**

> **OPERATIONAL NOTE:** All components must be deployed with **Zero-Trust segmentation**. The Relayer division must remain **dark and isolated** from the Compile Array. The Compile Array produces **unarmed scripts** (no private keys); only the Relayer possesses the kinetic signing authority.

**Ready to forge? Begin with `AEGIS-ORCH-01` deployment. The Compile Array awaits your contract target.**
