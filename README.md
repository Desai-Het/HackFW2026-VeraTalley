# VeraTally

[![CI](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml/badge.svg)](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A verifiable election platform for HackFW-2026 (Open track). The pitch: voters and observers
shouldn't have to trust an organizer's database. VeraTally runs an election on-chain - allowlisted
wallets, one vote each, enforced by code - so anyone can check the result for themselves, with no
account and no special access.

**Stack:** Solidity + Hardhat (contracts), Next.js + React + TypeScript + ethers.js (frontend, no
backend server), MetaMask (wallet), Polygon Amoy (testnet chain).

**Status: Sprint 1 (Increment A + B) complete.** This is a thin, fully working golden path - not
yet the full project. See [What's here](#whats-here-and-whats-not-yet) below for exactly what that
means.

## What's here, and what's not yet

Built and tested this sprint:

- `VoterRegistry` and `ElectionBallot` smart contracts: an admin-managed allowlist and a
  single-contest, single-choice ballot with a `Draft -> Open -> Closed` state machine.
- A full cast-a-vote flow: connect MetaMask, get guided onto the right network, see the ballot and
  your own eligibility/voted status, cast one vote, get refused on a second attempt or if
  unregistered, watch the live tally update.
- 20 passing Hardhat tests (100% statement/line/function coverage, 93% branch coverage), a Slither
  static-analysis pass (0 high-severity findings), and CI running all of it - lint, tests,
  coverage, static analysis, and secret scanning - on every push and pull request.

Not yet built (scoped to later increments - see `docs/sprints/sprint-01/requirements.md` and
`docs/architecture.md` for exactly why and when):

- Creating an election or managing the voter list through the app itself - right now the single
  demo election and its voters are set up by the deploy script, not a UI.
- `ElectionFactory` (the permissionless "anyone can create their own election" piece) and
  `ResultsCertification` (on-chain result certification + the public verification/recompute page).
- A live deployment. Everything below has been run and verified against a local Hardhat node in
  this build's environment; it has not yet been deployed to the Polygon Amoy testnet or hosted
  publicly, because both need a funded test wallet and a Vercel account that belong to the team,
  not this build process. `docs/architecture.md` has the exact commands for when that's ready.
- Ballot secrecy, ranked/multi-contest voting, gasless voting, and a few other things are out of
  scope for this entry by design, not oversight - see section 4.2 of the requirements doc for the
  full list and reasoning.

## Project structure

```
contracts/     Hardhat project: Solidity contracts, tests, deploy scripts
frontend/      Next.js app: the voting UI
docs/          architecture.md, decision-log.md, and per-sprint requirements docs
.github/       CI workflow
```

## Running it locally

Requires Node.js 20+ and the [MetaMask](https://metamask.io/) browser extension (Chrome, Firefox,
or Edge - desktop only, since it needs to reach a server running on your own machine).

```bash
npm ci

# Compile contracts and export their ABIs to frontend/lib/abi/
npm run contracts:compile

# Run the contract test suite (20 tests)
npm run contracts:test

# In one terminal: start a local chain
npx hardhat node --config contracts/hardhat.config.cjs
# (run from inside contracts/, or point --config at it as above)

# In another terminal: deploy, register two demo voters, and open voting
npm run contracts:deploy:local
```

The deploy script prints the deployed `VoterRegistry` and `ElectionBallot` addresses. Copy them
into `frontend/.env.local` (copy `frontend/.env.local.example` first):

```bash
cp frontend/.env.local.example frontend/.env.local
```

The example file defaults to Amoy's RPC URL and chain id. For local testing, edit
`frontend/.env.local` so all four values point at your local chain instead:

```
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545/
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS=<address the deploy script printed>
NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS=<address the deploy script printed>
```

Then:

```bash
npm run frontend:dev
```

Open `http://localhost:3000`. Before connecting, set MetaMask up for the local chain - the app's
network-switcher only knows how to auto-add Polygon Amoy (see `frontend/lib/network.ts`), so for a
local chain you add it yourself, once:

1. In MetaMask, add a network manually: RPC URL `http://127.0.0.1:8545/`, chain ID `31337`,
   currency symbol `ETH`.
2. Import one of the two demo voter accounts the deploy script registered, using its private key
   from the `hardhat node` terminal's printed account list (MetaMask: account icon -> **Import
   Account**). These are Hardhat's well-known default test keys - safe to use locally, but never
   send real funds to them on any live network.

Connect that account, cast a vote, and watch the tally update. Voting again, or voting from an
unregistered account, is refused with an explanation.

## Deploying to Polygon Amoy

See `docs/architecture.md`'s "Deploying beyond local" section - it needs a funded test wallet and
is not something this repository can do on its own.

## Contributing / sprint docs

This project follows the requirement-ID and sprint conventions in the HackFW-2026 requirements
doc (FR/CR/NFR/SR/OOS IDs, Must/Should/Could priority). Each sprint's scope and status is tracked
in `docs/sprints/sprint-NN/requirements.md`; architectural decisions are logged in
`docs/decision-log.md`.

## License

[MIT](LICENSE)
