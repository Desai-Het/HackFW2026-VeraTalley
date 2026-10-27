# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
"Report a vulnerability" option on this repository's Security tab, or contact the maintainers
directly. Include what you found, how to reproduce it, and the impact. We aim to acknowledge
reports within 5 working days.

## Scope

In scope: the Solidity contracts in `contracts/`, and the server routes and request handling in
`frontend/`. Out of scope: the public test chain itself, third-party services, and issues that need
a leaked secret or physical access to a voter's device or inbox.

## Handling secrets

Never commit `.env` files. Keep `RELAYER_PRIVATE_KEY` and `INVITE_SECRET` only in the host's
settings. Use throwaway wallets with test coins only. Rotate any secret that has been shared.
