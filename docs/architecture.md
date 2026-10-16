# Architecture

Status: current as of the QR self-registration and security-hardening work, on top of the
email-invite and gasless-voting work and Increments A-C. Kept current through each increment per
SR-04 ("`/docs/architecture.md` current as of freeze"). The product name is VeraTalley; on-chain
strings (EIP-712 domain, revert reasons) still say `VeraTally` because they are part of deployed
contracts and invite derivation.

## Shape of the system

There is still no database. The system has one small server component, which is a deliberate
exception to OOS-07 ("no backend") and should be recorded in `docs/decision-log.md`. The reason:
making voting wallet-free means someone has to pay the network fee on the voter's behalf and send
the invitation emails, and a static site cannot do either.

The frontend and the server talk to the blockchain in these ways:

- **Reads** (tally, state, eligibility, invite status, recount): a read-only JSON-RPC provider in
  the browser, so results are visible to anyone with the page open - no wallet, no login (FR-12).
- **Organizer writes** (create election, register invites or voters, open, close): the organizer's
  browser wallet (MetaMask) signs and sends the transaction and pays its own fee.
- **Voter writes** (claim an invite, cast a vote): the voter's browser signs a typed message
  (EIP-712) with a key it just created. It sends the signature to the relayer route, which submits
  the transaction and pays the fee. The contract checks the signature, so the relayer cannot alter
  what was signed.
- **Wallet voting** still works for addresses the organizer registered directly; those voters send
  `castVote` themselves and pay their own fee.

```
 Voter's browser                      Next.js server routes                Polygon Amoy testnet
┌────────────────────┐   signed msg   ┌───────────────────────┐   tx      ┌──────────────────────┐
│ /elections/N/vote   │ ─────────────> │ /api/relay             │ ───────> │ VoterRegistry.sol     │
│ makes a key, signs  │                │ pays the fee           │          │ ElectionBallot.sol    │
│ claim + vote        │                │ /api/invites/*         │          │ ElectionFactory.sol   │
└────────────────────┘                │ derives invites, sends │          └──────────────────────┘
        │  read (RPC)                  │ emails (Resend)        │                    ^
        └───────────────────────────────────────────────────────────────────────────┤
 Organizer's browser                                                                  │
┌────────────────────┐   write (signed tx)                                            │
│ window.ethereum     │ ──────────────────────────────────────────────────────────────┘
│ (MetaMask)          │
└────────────────────┘
```

## Contracts

- **`VoterRegistry.sol`** - the eligibility list for one election. `admin` (immutable) can call
  `registerVoters(address[])` and `addInvites(address[])`, both only while the election is in Draft:
  once voting opens the voter list is frozen. Anyone can call `claimInvite(voter, sig)`, which turns
  one unused invite into one eligible voter, using a signature from the invite's key. Anyone can
  read `isEligible`, `inviteStatus`, `inviteClaimedBy`, `inviteCount`, `inviteClaimedCount`. A
  claim is refused after the election closes. The registry learns which ballot it belongs to through
  a one-time `linkBallot`, which only its deployer (the factory) can call.
- **`ElectionBallot.sol`** - one contest, one vote per eligible address. `Draft -> Open -> Closed`,
  `onlyAdmin` `openVoting()`/`closeVoting()`. Two ways to vote: `castVote(candidateId)` for a
  registered wallet, and `castVoteBySig(voter, candidateId, sig)`, which anyone may submit but which
  only counts if `voter` signed exactly that choice. Both end in the same checks (open, eligible,
  not already voted, valid candidate) and emit `VoteCast(voter, candidateId)`.
- **`ElectionFactory.sol`** - `createElection(title, candidates)` deploys a registry and ballot,
  links them, and makes the caller the sole admin of both. No system admin exists above this
  (OOS-14). It keeps an index so the app can list elections.
- **`SignatureLib.sol`** - EIP-712 domain hashing and signature recovery. Every signature is bound
  to one contract on one chain, so one made for election A is useless on election B or another
  network. High-s signatures are rejected so each signature has one valid form.

All contracts are immutable once deployed: no proxy, no upgrade path, no pause or override (CR-04).

Not built yet:

- **`ResultsCertification.sol`** - would record the final tally on-chain after close, so the
  verification page could show a "certified result" next to the independent recount (FR-13). The
  recount from raw `VoteCast` events already exists; only the certified side is missing.

## Invites

An invite is a secret key whose public address is stored on-chain. The secret is a 20-character
code (about 100 bits of randomness, from an alphabet without look-alike characters) that is turned
into a key by hashing.

- **Derivation:** the server computes each code as an HMAC of the election's registry address and
  the person's email, using `INVITE_SECRET`. It stores nothing, so it can re-send the same link
  without a database, and one email can only ever produce one invite per election.
- **Two-step sending:** `POST /api/invites/prepare` returns invite addresses only. The organizer
  records them on-chain with `addInvites`. Then `POST /api/invites/send` checks each invite really
  is on-chain and unused before emailing the link. Nobody receives a link that does not work yet.
- **Organizer authentication:** both routes require a signed message from the wallet that
  administers the election, covering the action, election, email list and a timestamp (valid for 5
  minutes). Signing is free and sends no transaction.
- **The link:** `/elections/N/vote#CODE`. The code is after the `#`, which browsers never send to
  a server, so it stays out of server logs.
- **Claiming:** the voter's browser creates a fresh random key, kept in this browser's local
  storage, and signs `ClaimInvite(voter)` with the invite key. A copied claim can only register
  the same voter address, never a different one.
- **Voting:** the voter key signs `Vote(voter, candidateId)`. One vote per address already blocks
  replays, so no nonce is needed.

## Relayer

`/api/relay` (Next.js route) forwards two kinds of signed message and nothing else.

- **Scope:** the caller supplies an election number, and the server looks the contracts up in the
  factory. It cannot be pointed at an arbitrary address.
- **Checks before spending anything:** input shape, a dry-run of the transaction against the chain
  (so bad signatures and closed elections fail free), and a rate limit per client and overall.
- **Fees:** paid from a dedicated wallet (`RELAYER_PRIVATE_KEY`). On Amoy the priority fee is floored
  because public nodes sometimes suggest less than the network accepts.
- **Ordering:** one transaction at a time through a nonce-managed signer, so simultaneous voters do
  not collide. The queue and the rate limits live in memory, so run a single server instance;
  several instances would need a shared queue.
- **Who may use it:** only elections created by a wallet in `NEXT_PUBLIC_ORGANISER_WALLETS`.
  Otherwise anyone could create an election on the public factory and spend the relayer's funds.
  Duplicate concurrent claims or votes from the same voter are rejected while one is in flight.
- `GET /api/relay` returns only `{ ok, chainId, low }` (cached briefly, rate limited), so the voting
  page can warn when the relayer is down or low on funds without exposing its address or balance.

## Frontend

Next.js (App Router) + React + TypeScript + ethers.js v6. The repository pins Next 14; an optional
upgrade to Next 16 / React 19 (Node 20.9+, `middleware.ts` renamed `proxy.ts`) clears all known
`npm audit` advisories.

Pages:

- `/` landing, `/elections` searchable list, `/elections/create`
- `/elections/[id]` election page (voter view; organizer panel for the election's admin)
- `/elections/[id]/vote` the emailed-link voting page
- `/elections/[id]/verify` recount from events; `/elections/[id]/live` live results
- `/register/[id]` public self-registration form, reached by QR code (needs the link secret after `#`)
- `/demo` the original single-election demo, driven by the two address variables

Code:

- `lib/contracts.ts` - provider and contract getters, and `describeError()`, which turns this
  project's `"VeraTally: ..."` revert reasons into plain-language copy (NFR-04).
- `lib/invite.ts` - shared by browser and server: code format, key derivation, the two typed
  messages, organizer authentication message, email parsing.
- `lib/relay.ts`, `lib/voting.ts` - talking to the relayer; reading invite status and finding a
  voter's recorded vote from events; the voter key's local storage.
- `lib/verify.ts` - the recount: reads every `VoteCast`, `VoterRegistered`, `InviteAdded` and
  `InviteClaimed` event, compares against the contract's own tally and invitation counters, and
  reports issued, used and voted invitations.
- `lib/server/*` - server-only: configuration, relayer signer, invite derivation, email sending.
- `lib/brand.ts` - the app name and tagline, used everywhere the user sees them.
- `lib/organisers.ts` - parses the organiser wallet list; the client uses it to hide elections made
  by other wallets.
- `lib/registration.ts`, `lib/server/regstore.ts`, `lib/server/regauth.ts` - registration types and
  rules, the file store, and organiser sessions and link keys.
- `app/api/relay`, `app/api/invites/{prepare,send}`, `app/api/registration/{info,submit,session,admin}`
  - the server routes.
- `middleware.ts` (`proxy.ts` on Next 16) - the request filter in front of `/api`.
- `lib/abi/*.abi.json` - generated by `contracts/scripts/export-abi.js` after `contracts:compile`.
  Never hand-edit these.

## Registration by QR code

Organisers can collect voters without typing emails. From the election page they open
registration and show a QR code that points to `/register/N#KEY`.

- **Link secret:** `KEY` is derived with HMAC from the election and a per-election `linkVersion`
  and sits after `#`, so it never reaches a log. "New QR code" bumps the version and kills old links.
- **Submitting:** the form posts name, email and any extra fields the organiser configured. The
  response is identical for new and duplicate sign-ups, so it cannot be used to discover who is
  registered.
- **Flags:** the same email in another form (case, `+tag` and Gmail dots are normalised), the same
  device (hashed `vt_dev` cookie), the same network (5 or more per hour), a disallowed email domain,
  and a hidden honeypot field. Unflagged sign-ups can be auto-approved; flagged ones wait for review.
- **Organiser access:** the organiser signs a message once (free) and receives a 30-minute session
  token (stateless HMAC). Listing, approving, rejecting, exporting CSV (formula-safe), replacing the
  QR and purging all require it.
- **Storage:** a JSON file in `DATA_DIR` (default `.data/`), written atomically under a mutex. It
  needs a persistent disk and one server instance. It is not encrypted; purge it after the event.
- **Hand-off:** approved people go into the invite box and then the normal two-step invitation flow.

## Server protection

Layers, outermost first:

1. **Request filter** (`middleware.ts` / `proxy.ts`): only GET and POST on the known API paths;
   POST bodies must be JSON and at most 20 KB; cross-site requests (`Origin`, `Sec-Fetch-Site`) are
   refused; responses are `no-store` and `nosniff`.
2. **Security headers** (`next.config.js`): CSP, `X-Frame-Options: DENY`, HSTS in production,
   Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed.
3. **Organiser allow-list:** relay, invitations and registrations serve only elections created by a
   wallet in `NEXT_PUBLIC_ORGANISER_WALLETS`. Required on public chains; if unset there, those
   routes return 503. On the local chain (31337) an empty list allows everyone.
4. **Signed, site-bound admin requests:** the signed message names the action, election, a
   timestamp and the website host (`PUBLIC_BASE_URL`, else the request host), so a signature made
   on a look-alike site is useless here.
5. **Rate limiting:** per visitor first, keyed by the rightmost `X-Forwarded-For` entry according to
   `TRUSTED_PROXY_HOPS`, then a global cap after validation. Old entries are swept, never cleared
   all at once. Limits are in memory, so run one instance.
6. **Contract limits:** at most 50 candidates and 200 bytes of text for the title and each name
   (applies to factories deployed after this change).

## Trust model

Votes are public and linked to an anonymous voter ID (OOS-01: no ballot secrecy). What each party
can and cannot do:

- **Relayer server:** can refuse or delay a vote. Cannot change or forge one.
- **Holder of `INVITE_SECRET` (the server operator):** can recompute any invite code. That means
  it can claim an unused invite and vote with it, and can link an email to the voter ID that
  claimed that email's invite. It cannot vote as someone who has already claimed, because their
  voting key is made in their own browser and never sent anywhere.
- **Organizer:** chooses who is invited and when voting opens and closes. Cannot add voters after
  voting opens or change candidates.
- **Anyone:** can recount the whole election from chain events.

Ballot stuffing through unused invites is detectable, not prevented: invited, registered and voted
counts are all readable on-chain, and can be compared with an attendance list.

Known limits: a voter who clears browser data after claiming but before voting cannot use that
invite; anyone with access to a voter's inbox can vote as them; the relayer's queue and rate limits
are per instance.

## Testing and static analysis

- 116 Hardhat tests: 100% statement, line and function coverage; 96% branch coverage (the
  remaining branches are in `VoterRegistry`). They include signature edge cases: a malformed
  `v`, the 0/1 form of `v`, and the malleated high-`s` twin of a valid signature.
- Slither (102 detectors): nothing high or medium. Seven low or informational notes, all reviewed:
  - *Reentrancy (benign, events) in `ElectionFactory.createElection`*: the external call goes to
    the registry the factory has just deployed itself, which holds no untrusted code.
  - *Assembly in `SignatureLib.recover`*: reads the three parts of a 65-byte signature; covered by
    the edge-case tests above.
  - *Costly operations in a loop* (`registerVoters`, `addInvites`): the counters are updated per
    entry; batches are capped in the UI.
  - *Naming convention* and *cache array length*: style and gas notes with no security impact.

## Running it locally (verified end to end)

```
npm ci
npm run contracts:compile      # also exports ABIs to frontend/lib/abi/
npm run contracts:test         # 116 passing
npx hardhat node --config contracts/hardhat.config.cjs   # one terminal, from contracts/
npm run contracts:deploy:local # another terminal - deploys the factory and a demo election
# put the printed factory address and the server-only settings in frontend/.env.local
npm run frontend:dev
```

The complete flow - create an election, send invitations, open voting, vote from a browser with no
wallet, reload and see the recorded vote, check it from a second browser with empty storage, refuse
a forged or replayed signature, close, and recount - was run with a real headless browser
(Playwright) against the real Next.js server and a real local chain, not only as contract tests.

## Deploying beyond local

The step-by-step version is in the README ("Deploy to a public network"). In outline:

1. **Contracts** - fund a throwaway deployer from an Amoy faucet, copy `contracts/.env.example` to
   `contracts/.env` (never committed, NFR-03), set `AMOY_RPC_URL` and `PRIVATE_KEY`, and run
   `npm run contracts:deploy:amoy`. The address is saved to
   `contracts/deployed-addresses.amoy.json` (public, safe to commit). Source verification on
   Polygonscan (CR-05) needs `ETHERSCAN_API_KEY`.
2. **Relayer wallet** - a second throwaway wallet funded with a little test POL. It is the only
   wallet voters depend on, and it must differ from the organiser wallet.
3. **Hosting** - an always-on Node process with a persistent disk (Render, Railway, Fly.io or a
   VPS), one instance. Serverless hosting such as Vercel does not fit: the registration file needs a
   disk and the relayer queue and rate limits live in memory. Settings go in the host's environment,
   never the repository: `RELAYER_PRIVATE_KEY`, `INVITE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `NEXT_PUBLIC_ORGANISER_WALLETS`, `PUBLIC_BASE_URL`, `TRUSTED_PROXY_HOPS`, `DATA_DIR`.
4. **Domain and HTTPS** - point the domain at the host and serve over HTTPS. Restrict the RPC
   provider key to the domain.
5. **Email** - create a Resend account, verify a sending domain, then set `INVITE_DELIVERY=email`.
   Until then `INVITE_DELIVERY=links` gives the organiser the links to hand out.

Known operational limits: single instance; registrations stored unencrypted in a file; rotating
`INVITE_SECRET` invalidates sent invitations; Amoy needs a priority fee of about 25 gwei, which the
app floors at 30 gwei on chain 80002.

## Decision log

See `docs/decision-log.md` for logged decisions (fields match `decision_log.xlsx`'s convention per
section 11.3: ID, date, status, decision, context, alternatives, consequences, owner). Decisions
from this work that should be logged: the exception to OOS-07 for a relayer and invite server;
email-derived invites with a server-held secret; the voter list freezing when voting opens; the
organiser allow-list for the relayer and email; file-backed registrations (and the resulting
single-instance, persistent-disk hosting requirement); keeping `VeraTally` strings on-chain after the
rename to VeraTalley.
