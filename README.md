# VeraTally

[![CI](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml/badge.svg)](https://github.com/dojoga1/HackFW2026-VeraTalley/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A verifiable election platform for HackFW-2026 (Open track). The pitch: voters and observers
shouldn't have to trust an organizer's database. VeraTally runs an election on-chain - one vote per
eligible voter, enforced by code - so anyone can recount the result for themselves, with no account
and no special access.

Voters don't need a crypto wallet or any coins. The organizer pastes a list of emails, each person
gets a personal voting link, and a small server pays the network fee for them. The server can
refuse a vote but cannot change or forge one, because the contract checks every signature itself.

**Stack:** Solidity + Hardhat (contracts), Next.js + React + TypeScript + ethers.js (frontend and a
small server component for gasless voting and invite emails), MetaMask (organizer's wallet),
Polygon Amoy (testnet chain), Resend (invite emails).

**Status:** the full flow works end to end on a local chain. It has not been deployed to Polygon
Amoy or hosted publicly yet. See [What's here](#whats-here-and-whats-not-yet) below.

## What's here, and what's not yet

Built and tested:

- **Contracts:** `VoterRegistry`, `ElectionBallot` (a `Draft -> Open -> Closed` state machine,
  single contest, one vote each), `ElectionFactory` (anyone can create their own election and
  becomes its sole admin), and a small `SignatureLib` for typed-data signatures.
- **Voting by email link, no wallet needed.** The organizer pastes emails; each person gets a
  personal link; they pick a candidate and vote. Behind the scenes their browser makes a private
  key, signs the vote, and a server submits it and pays the fee. See
  [How voting by email works](#how-voting-by-email-works).
- **Wallet voting still works** for anyone the organizer adds by wallet address (the original flow).
- **The voter list locks once voting opens**, so an organizer cannot add voters after seeing how
  the vote is going. The contract enforces it.
- **Organizer tools:** create an election, invite voters, open and close voting, share a link/QR.
- **Public verification:** anyone can recount an election from the on-chain vote events, with no
  wallet, and compare it to the tally the contract reports. The page also shows how many
  invitations were issued, used, and voted, so an organizer's attendance list can be checked
  against them.
- **Tests:** 115 passing Hardhat tests with 100% statement, line and function coverage and 96%
  branch coverage. A Slither static-analysis pass finds nothing high or medium severity (seven
  low or informational notes, listed in `docs/architecture.md`). An end-to-end browser run of the
  whole flow (create, invite, vote with no wallet, check the vote from another device, recount)
  passes against a local chain.

Not built yet:

- **A live deployment.** Everything has been run against a local Hardhat node. Deploying to Polygon
  Amoy needs funded test wallets, and hosting needs a Vercel account (or similar) and an email
  sending domain, which belong to the team. See [Deploying](#deploying-to-polygon-amoy).
- **`ResultsCertification`** (writing the final tally on-chain after close). The recount page
  already rebuilds the result from raw events; certification would add a recorded "official" result
  to compare against.
- Ballot secrecy, ranked or multi-contest voting, and a few other things are out of scope by
  design, not oversight. See section 4.2 of the requirements doc.

## How voting by email works

1. The organizer creates an election and pastes the voters' emails. The organizer's wallet signs
   one free message to prove they run the election, then records the invitations on-chain.
2. The server emails each person a link like `/elections/3/vote#K7QM2-9XWPA-4HT8R-D3VNC`. The code
   after `#` never reaches any server log, because browsers don't send that part.
3. The voter opens the link. Their browser creates a brand-new private key that only they hold,
   uses the invite to register that key as a voter, then signs their vote with it.
4. A server sends both signed messages to the blockchain and pays the fee. The contract checks the
   signatures, so a tampered request simply fails.
5. The voter sees a receipt and can look their vote up again later from the same link, or check it
   independently on the public block explorer.

## Trust model: what to know before relying on this

Votes are public by design. Everyone can see how each anonymous voter ID voted; the point is that
anyone can recount.

| Who | Can | Cannot |
| --- | --- | --- |
| The relayer server | Refuse or delay votes | Change a vote or vote for someone (signatures are checked on-chain) |
| Whoever holds `INVITE_SECRET` (the server operator) | Recompute every invite code; claim an **unused** invite and vote with it; link an email to its anonymous voter ID | Vote as a person who has already claimed their invite |
| The organizer | Choose who is invited, open and close voting | Add voters after voting opens, or change candidates |
| Anyone | Recount the election from chain events | - |

In plain terms:

- Voting by email trusts the server operator more than wallet voting does. The operator could stuff
  votes using invites nobody has claimed. This is detectable (invited, registered and voted counts
  are public on-chain and shown on the Verify page), not prevented. Compare them with your attendance list.
- The operator can also work out which anonymous ID belongs to which email. Outside observers
  cannot. This is **not** a secret ballot.
- A voter who clears their browser data after registering but before voting cannot vote with that
  invite. The window is a few seconds in normal use.
- Anyone with access to a voter's inbox can vote as them.

## Project structure

```
contracts/     Hardhat project: Solidity contracts, tests, deploy scripts
frontend/      Next.js app: the UI, plus the API routes for gasless voting and invites
docs/          architecture.md, decision-log.md, and per-sprint requirements docs
.github/       CI workflow
```

## Running it locally

Requires Node.js 20+ and the [MetaMask](https://metamask.io/) browser extension for the organizer
(Chrome, Firefox, or Edge, desktop only). Voters need no extension.

```bash
npm ci

# Compile contracts and export their ABIs to frontend/lib/abi/
npm run contracts:compile

# Run the contract test suite (115 tests)
npm run contracts:test

# In one terminal: start a local chain (run from inside contracts/, or point --config at it)
npx hardhat node --config contracts/hardhat.config.cjs

# In another terminal: deploy the factory and a demo election
npm run contracts:deploy:local
```

Copy the example settings file and fill it in:

```bash
cp frontend/.env.local.example frontend/.env.local
```

For a local chain, set these in `frontend/.env.local`:

```
NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=<address the deploy script printed>
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545/

# Server-only settings (never prefix these with NEXT_PUBLIC_, never commit this file)
RELAYER_PRIVATE_KEY=<private key of "Account #1" from the hardhat node terminal>
INVITE_SECRET=<any random string of 32+ characters>
INVITE_DELIVERY=links
```

`INVITE_DELIVERY=links` skips email: the organizer gets copyable links instead, which is the easiest
way to try it locally. The Hardhat keys are public test keys, safe to use locally and never to be
used on a live network.

| Setting | Purpose |
| --- | --- |
| `NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS` | The factory every page reads elections from |
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` | Which chain, and how to read it |
| `NEXT_PUBLIC_EXPLORER_URL` | Optional block explorer for receipt links (defaults by chain) |
| `RELAYER_PRIVATE_KEY` | A dedicated throwaway wallet that pays fees for voters. Fund it with a little test POL. |
| `INVITE_SECRET` | Derives each invite code. Treat it like a password. |
| `INVITE_DELIVERY` | `email` (send with Resend) or `links` (organizer gets the links) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Needed when `INVITE_DELIVERY=email` |
| `PUBLIC_BASE_URL` | Optional: the site address used inside invite emails |

Then:

```bash
npm run frontend:dev
```

Open `http://localhost:3000`. Check `http://localhost:3000/api/relay`: it should report `"ok":true`
and the relayer's balance.

**Try it as an organizer:** add a local network to MetaMask (RPC `http://127.0.0.1:8545/`, chain ID
`31337`, symbol `ETH`) and import one of the Hardhat accounts from the node terminal. Create an
election, paste two or three emails, send the invitations, then open voting.

**Try it as a voter:** open one of the links in a private browser window with no wallet, pick a
candidate, and vote. Reload to see the recorded vote, then open the Verify page and run the recount.

If MetaMask shows nonce errors after you restart the local node, clear its activity data
(Settings -> Advanced -> Clear activity tab data).

## Deploying to Polygon Amoy

See `docs/architecture.md`'s "Deploying beyond local" section. In short: fund a deployer wallet and
a separate relayer wallet from an Amoy faucet, deploy the contracts, host the frontend somewhere
that can run server routes, put the server-only settings in the host's settings (not in the
repository), and set up Resend with a verified sending domain.

## Contributing / sprint docs

This project follows the requirement-ID and sprint conventions in the HackFW-2026 requirements
doc (FR/CR/NFR/SR/OOS IDs, Must/Should/Could priority). Each sprint's scope and status is tracked
in `docs/sprints/sprint-NN/requirements.md`; architectural decisions are logged in
`docs/decision-log.md`.

## License

[MIT](LICENSE)
