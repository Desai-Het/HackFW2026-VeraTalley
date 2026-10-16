# VeraTalley

[![CI](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml/badge.svg)](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-363636)
![Next.js](https://img.shields.io/badge/Next.js-App%20Router-000000)
![Network](https://img.shields.io/badge/Network-Polygon%20Amoy-8247e5)

**Elections you can recount yourself.**

VeraTalley is a verifiable election platform built for HackFW-2026 (Open track). Voters and
observers should not have to trust an organiser's database. VeraTalley runs the election on-chain:
one vote per eligible voter, enforced by code, so anyone can recount the result with no account and
no special access.

Voters need no crypto wallet and no coins. The organiser adds voters by email or by sharing a
registration QR code, each person gets a personal voting link, and a small server pays the network
fee. The server can refuse a vote but cannot change or forge one, because the contract checks every
signature itself.

> The product is called **VeraTalley**. Some on-chain strings and internal identifiers still read
> `VeraTally` (the contract's signing domain and revert messages). They are part of deployed
> contracts and invite codes, so they were left unchanged on purpose.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start: run it locally](#quick-start-run-it-locally)
- [Deploy to a public network (Polygon Amoy)](#deploy-to-a-public-network-polygon-amoy)
- [Configuration reference](#configuration-reference)
- [Security and trust model](#security-and-trust-model)
- [Project structure](#project-structure)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Documentation, contributing, license](#documentation-contributing-license)

## Features

- **Contracts:** `VoterRegistry`, `ElectionBallot` (a `Draft -> Open -> Closed` state machine, one
  contest, one vote each), `ElectionFactory` (anyone can create an election and becomes its sole
  admin) and `SignatureLib` (EIP-712 typed-data signatures). Contracts are immutable: no proxy, no
  upgrade path, no pause switch.
- **Voting by email link, no wallet needed.** The voter's browser creates its own key, signs the
  vote, and a relayer submits it and pays the fee.
- **Self-registration by QR code.** The organiser shows a QR code; people scan it and register with
  their name and email. Duplicate or suspicious sign-ups (same device, same network, repeated
  emails) are flagged for review, and approved people can be invited in one click.
- **Wallet voting** still works for anyone the organiser adds by wallet address.
- **The voter list locks when voting opens**, enforced by the contract.
- **Public verification:** anyone can recount an election from on-chain events and compare it with
  the contract's own tally. The page also shows invitations issued, used and voted.
- **Hardened server:** organiser allow-list, signed and site-bound admin requests, rate limiting,
  request filtering, security headers. See [Security](#security-and-trust-model).
- **Tests:** 116 Hardhat tests (100% statement, line and function coverage), Slither static
  analysis with nothing high or medium, and a browser end-to-end run of the whole flow.

## How it works

```
 Voter's browser                 Next.js server routes              Blockchain
┌──────────────────┐ signed msg ┌─────────────────────┐    tx     ┌────────────────────┐
│ /elections/N/vote │ ─────────> │ /api/relay           │ ───────> │ ElectionFactory     │
│ makes a key,      │            │ /api/invites/*       │          │ ElectionBallot      │
│ signs the vote    │            │ /api/registration/*  │          │ VoterRegistry       │
└──────────────────┘            └─────────────────────┘          └────────────────────┘
Organiser's browser (MetaMask) ── signs and sends its own transactions ──────^
```

1. The organiser connects MetaMask, creates an election and adds voters (invite by email, or open a
   registration QR and approve sign-ups).
2. Each voter gets a link like `/elections/3/vote#K7QM2-9XWPA-4HT8R-D3VNC`. The code after `#` is
   never sent to any server, so it stays out of logs.
3. The voter opens the link. Their browser creates a private key that only they hold, uses the
   invite to register it as a voter, and signs the vote with it.
4. The relayer sends both signed messages to the chain and pays the fee. The contract verifies the
   signatures, so a tampered request simply fails.
5. The voter gets a receipt. Anyone can recount the election from the public events.

## Quick start: run it locally

Everything runs on your computer with a local test chain. No accounts, coins or API keys.

**Requirements:** Node.js 20.9 or newer and npm, a desktop browser with the
[MetaMask](https://metamask.io/) extension (organisers only; voters need nothing), and Git.

### 1. Install and test

```bash
git clone https://github.com/dojoga1/HackFW2026-VeraTalley.git
cd HackFW2026-VeraTalley
npm ci
npm run contracts:compile      # compiles contracts and exports ABIs to frontend/lib/abi/
npm run contracts:test         # optional: 116 tests
```

### 2. Start a local chain (terminal 1, leave it running)

```bash
npm run contracts:node
```

It prints 20 test accounts with their private keys. These keys are public and only safe on this
local chain.

### 3. Deploy the contracts (terminal 2)

```bash
npm run contracts:deploy:local
```

Copy the `ElectionFactory` address it prints.

### 4. Configure the app

```bash
cp frontend/.env.local.example frontend/.env.local
```

Edit `frontend/.env.local` and set:

```dotenv
NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=<address from step 3>
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
RELAYER_PRIVATE_KEY=<private key of "Account #1" from terminal 1>
INVITE_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
INVITE_DELIVERY=links
```

`INVITE_DELIVERY=links` skips email; the organiser gets copyable links instead.

### 5. Run the app

```bash
npm run frontend:dev
```

Open <http://localhost:3000>. Check <http://localhost:3000/api/relay>: it should show `"ok":true`.

### 6. Try it

- **Organiser:** add a network to MetaMask (RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol
  `ETH`) and import "Account #0" from terminal 1. Create an election, add two or three emails, send
  the invitations, then open voting.
- **Voter:** open one of the links in a private window with no wallet, pick a candidate and vote.
  Reload to see the recorded vote, then open the Verify page and run the recount.
- **Registration QR:** in the organiser panel, open registration, scan or open the QR link in
  another window, sign up, and approve it in the list.

## Deploy to a public network (Polygon Amoy)

This puts the contracts on the Polygon Amoy testnet and the app on a public address. It costs
nothing: Amoy uses free test coins.

### What you need

| Item | Why | Where |
| --- | --- | --- |
| Deployer wallet | Deploys the factory. Throwaway, test coins only. | New MetaMask account |
| Relayer wallet | Pays fees for voters. Throwaway, different from the others. | New MetaMask account |
| Organiser wallet | Creates and runs elections. Can be the deployer. | MetaMask |
| Test POL | Fees. About 0.3 POL for the deployer and 0.1-0.5 for the relayer is plenty to start. | An Amoy faucet |
| Amoy RPC URL | Reads and writes the chain. | Alchemy, QuickNode or dRPC (free tier). Must contain `polygon-amoy`. |
| A host | Runs the app. See step 4. | Render, Railway, Fly.io or a VPS |
| Email (optional) | Sends invitations. | [Resend](https://resend.com) with a verified domain |

Never use a wallet that holds real money for any of this.

### 1. Deploy the contracts

```bash
cp contracts/.env.example contracts/.env
# edit contracts/.env: AMOY_RPC_URL and PRIVATE_KEY (the deployer wallet)
npm run contracts:deploy:amoy
```

It prints the `ElectionFactory` address and saves it to `contracts/deployed-addresses.amoy.json`
(safe to commit; it is public information). To verify the source on Polygonscan, set
`ETHERSCAN_API_KEY` in `contracts/.env`.

### 2. Configure the app

```bash
cp frontend/.env.local.example frontend/.env.local
```

```dotenv
NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=<address from step 1>
NEXT_PUBLIC_CHAIN_ID=80002
NEXT_PUBLIC_RPC_URL=<your Amoy RPC URL>
NEXT_PUBLIC_ORGANISER_WALLETS=<public address(es) of your organiser wallet>
RELAYER_PRIVATE_KEY=<relayer wallet key>
INVITE_SECRET=<32+ random characters>
INVITE_DELIVERY=links
```

`NEXT_PUBLIC_ORGANISER_WALLETS` is required on a public chain. Without it the relayer, invitations
and registrations refuse to run, which protects you from strangers using your relayer.

### 3. Try it on your machine first

```bash
npm run frontend:dev
```

Switch MetaMask to Polygon Amoy, create an election, invite yourself and vote. Check
<http://localhost:3000/api/relay> shows `"ok":true` and that `low` is `false`.

### 4. Host it

The app has a server part that keeps a queue in memory and saves registrations to a file, so it
needs a host that runs one always-on Node process with a persistent disk. **Serverless platforms
such as Vercel are not suitable for the full app** (the registration file would be lost and the
relayer queue would split across instances).

On Render, Railway or Fly.io (or a VPS):

1. Create a web service from this repository. Leave the root directory as the repository root,
   because the lockfile lives there (the project is an npm workspace).
2. Build command `npm ci && npm run frontend:build`, start command `npm run frontend:start`.
   Node 20.9 or newer.
3. Attach a persistent disk, for example mounted at `/data`.
4. Set the environment variables from `frontend/.env.local.example` in the host's settings (not in
   the repository), plus:
   ```dotenv
   PUBLIC_BASE_URL=https://your-domain.com
   TRUSTED_PROXY_HOPS=1
   DATA_DIR=/data
   ```
5. Run **one** instance only.
6. Point your domain at the service and make sure it is served over HTTPS (most hosts do this
   automatically).
7. In your RPC provider's dashboard, restrict the API key to your domain.

Running it on a Synology NAS instead? Follow [docs/deploy-synology.md](docs/deploy-synology.md); the
repository includes a `Dockerfile` and `deploy/synology/docker-compose.yml` for it.

### 5. Email invitations (optional)

Create a Resend account, verify a sending domain, then set `RESEND_API_KEY`, `EMAIL_FROM` and
`INVITE_DELIVERY=email`. Until then `INVITE_DELIVERY=links` lets the organiser hand out links.

### 6. Go-live checklist

- [ ] Factory deployed and `NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS` set
- [ ] `NEXT_PUBLIC_ORGANISER_WALLETS` set to your wallet(s)
- [ ] Relayer wallet funded; `/api/relay` reports `ok` and `low: false`
- [ ] `INVITE_SECRET` is a fresh random value used nowhere else
- [ ] `PUBLIC_BASE_URL` matches the real address; HTTPS works
- [ ] `TRUSTED_PROXY_HOPS` matches the host; only one instance is running
- [ ] `DATA_DIR` points to a persistent disk
- [ ] RPC key restricted to your domain
- [ ] A full test run: create, register, invite, vote, close, recount

To run on a different EVM network, set `NEXT_PUBLIC_CHAIN_ID` and the RPC, add the network to
`contracts/hardhat.config.cjs`, and review the fee settings in `frontend/lib/server/config.ts`.

## Configuration reference

**Contracts (`contracts/.env`)**

| Setting | Purpose |
| --- | --- |
| `AMOY_RPC_URL` | Amoy RPC from a provider (must contain `polygon-amoy`) |
| `PRIVATE_KEY` | Throwaway deployer wallet key |
| `CREATE_DEMO_ELECTION`, `DEMO_VOTER_ADDRESSES` | Optional: also create a demo election on Amoy |
| `ETHERSCAN_API_KEY` | Optional: verify source on Polygonscan |

**App (`frontend/.env.local`, or the host's environment)**

| Setting | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS` | Yes | The factory every page reads elections from |
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` | Yes | Which chain, and how to read it |
| `NEXT_PUBLIC_ORGANISER_WALLETS` | Yes on public chains | Wallets allowed to run elections (public addresses) |
| `RELAYER_PRIVATE_KEY` | Yes | Throwaway wallet that pays fees for voters |
| `INVITE_SECRET` | Yes | Derives invite codes. Treat like a password. |
| `INVITE_DELIVERY` | Yes | `links` or `email` |
| `RESEND_API_KEY`, `EMAIL_FROM` | If `email` | Sending invitations |
| `PUBLIC_BASE_URL` | In production | Exact public address of the site |
| `TRUSTED_PROXY_HOPS` | In production | Number of proxies in front of the app (default 1) |
| `DATA_DIR` | In production | Persistent folder for registrations (default `.data`) |
| `NEXT_PUBLIC_EXPLORER_URL` | No | Block explorer for receipt links |

Anything starting with `NEXT_PUBLIC_` is visible to every visitor. Never put secrets there.

## Security and trust model

Votes are public by design: everyone can see how each anonymous voter ID voted, and that is what
lets anyone recount. This is not a secret ballot.

| Who | Can | Cannot |
| --- | --- | --- |
| The relayer server | Refuse or delay votes | Change a vote or vote for someone (signatures are checked on-chain) |
| Whoever holds `INVITE_SECRET` | Recompute invite codes; claim an **unused** invite; link an email to its anonymous voter ID | Vote as someone who already claimed their invite |
| The organiser | Choose who is invited; open and close voting | Add voters after voting opens, or change candidates |
| Anyone | Recount from chain events | - |

Known limits:

- Ballot stuffing through unused invites is detectable, not prevented. Compare the invited,
  registered and voted counts on the Verify page with your attendance list.
- A voter who clears browser data after claiming but before voting cannot use that invite.
- Anyone with access to a voter's inbox can vote as them.
- The relayer queue and rate limits are in memory, so run one instance.
- The registration file is not encrypted. Keep the disk private and purge it after the event.

Built-in protections: only organiser wallets can use the relayer, invitations and registrations;
organiser requests are signed by the wallet, expire quickly and are bound to this site; registration
links carry a secret that can be replaced; rate limits apply per visitor and overall; a request
filter accepts only the app's own API calls; and security headers (CSP, framing, HSTS) are set.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Project structure

```
contracts/     Hardhat project: Solidity contracts, tests, deploy and diagnostic scripts
frontend/      Next.js app: UI plus the API routes for the relayer, invitations and registrations
  proxy.ts / middleware.ts   request filter in front of /api
  lib/brand.ts               the app name (change it in one place)
  lib/server/                server-only code: config, relayer, invites, email, registrations
docs/          architecture.md, decision-log.md, and per-sprint requirements docs
.github/       CI workflow
```

## Development

| Command | What it does |
| --- | --- |
| `npm run contracts:compile` | Compile contracts and export ABIs |
| `npm run contracts:test` | Run the Hardhat tests |
| `npm run contracts:deploy:local` | Deploy to a running local node |
| `npm run contracts:deploy:amoy` | Deploy to Polygon Amoy |
| `npm run frontend:dev` | Start the app in development mode |
| `npm run contracts:node` | Start a local test chain |
| `npm run contracts:coverage` | Test coverage report |
| `npm run frontend:build` | Production build of the app |
| `npm run frontend:start` | Run the production build |
| `npm run frontend:lint` | Lint the app |

Do not hand-edit `frontend/lib/abi/*.abi.json`; they are generated. Contract changes need a
recompile and a new factory deployment.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| MetaMask shows nonce errors after restarting the local node | Settings -> Advanced -> Clear activity tab data |
| `/api/relay` says not configured or `low: true` | Check `RELAYER_PRIVATE_KEY`, and fund that wallet with test POL |
| "This server has no organiser wallets set up" (503) | Set `NEXT_PUBLIC_ORGANISER_WALLETS`, then restart |
| "This website does not serve that election" (403) | The election was created by a wallet not in `NEXT_PUBLIC_ORGANISER_WALLETS` |
| MetaMask "Interaction failed" on Amoy | The fee was too low and the transaction never mined; update to the latest code (fee floor) and retry |
| Deploy fails with an RPC error | `AMOY_RPC_URL` must be a provider URL containing `polygon-amoy` |
| Registration link says "link is incomplete" | The part after `#` was cut off; copy the full link or use "New QR code" |
| Registrations disappear after a deploy | `DATA_DIR` is not on a persistent disk |
| Changes to `.env.local` ignored | Restart the server |

## Documentation, contributing, license

- [docs/architecture.md](docs/architecture.md): design, contracts, server routes, hosting.
- `docs/decision-log.md`: architectural decisions. `docs/sprints/`: per-sprint requirements.
- This project follows the requirement-ID and sprint conventions of the HackFW-2026 requirements
  doc (FR/CR/NFR/SR/OOS IDs, Must/Should/Could priority).
- Before opening a pull request, run `npm run contracts:test` and `npm run frontend:build`, and
  never commit `.env` files.

Released under the [MIT License](LICENSE).
