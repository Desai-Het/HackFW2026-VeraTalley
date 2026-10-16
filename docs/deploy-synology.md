# Hosting VeraTalley on a Synology NAS

This runs the app in Docker on your NAS and makes it reachable at your own domain through a
Cloudflare Tunnel. No router ports are opened and your home IP address stays hidden.

```
Voter's browser ──HTTPS──> Cloudflare ──tunnel──> cloudflared (NAS) ──> app container (NAS)
                                                                          └─ /data (NAS folder)
```

## Before you start

- Synology DiskStation Manager (DSM) 7.2 or newer with the **Container Manager** package.
  Intel and ARM models both work. Allow 2 GB of free memory for the first build.
- A domain whose DNS is managed by Cloudflare (free plan is enough), for example `vote.example.com`.
- The contract factory already deployed (see the README), and your organiser and relayer wallets.
- This repository on the NAS (next section).

## 1. Put the code on the NAS

Easiest: in **File Station**, create `docker/veratalley/` and upload the repository folder into it
so you have `/volume1/docker/veratalley/repo/Dockerfile`. Or, with SSH enabled, run
`git clone <your repo url> /volume1/docker/veratalley/repo`.

Also create an empty folder for registrations: `/volume1/docker/veratalley/data`.

## 2. Create the Cloudflare tunnel

1. In Cloudflare, open **Zero Trust -> Networks -> Tunnels -> Create a tunnel -> Cloudflared**.
2. Name it (for example `veratalley`) and copy the **tunnel token** shown for Docker.
3. Under **Public hostname**, add `vote.example.com` with service type **HTTP** and URL `app:3000`.

## 3. Fill in the settings

In `repo/deploy/synology/`, copy `.env.example` to `.env` and edit it (File Station's text editor,
or SSH). Set at least:

- `NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`,
  `NEXT_PUBLIC_ORGANISER_WALLETS`
- `RELAYER_PRIVATE_KEY` (throwaway wallet, small balance) and a fresh `INVITE_SECRET`
- `PUBLIC_BASE_URL=https://vote.example.com` and `TRUSTED_PROXY_HOPS=1`
- `CLOUDFLARE_TUNNEL_TOKEN` from step 2
- `PUID` / `PGID`: your NAS user's numbers. Over SSH run `id <your-username>`.
- `DATA_HOST_PATH=/volume1/docker/veratalley/data`

Restrict who can read `.env`; it holds secrets. The `NEXT_PUBLIC_*` values are built into the
website, so changing one later means rebuilding (step 5 below).

## 4. Start it

1. Open **Container Manager -> Project -> Create**.
2. Project name `veratalley`, path `/volume1/docker/veratalley/repo/deploy/synology`.
3. Choose **Use existing docker-compose.yml**, continue, and finish.

The first build takes several minutes. When both containers show **Running**, open
`https://vote.example.com`.

## 5. Check it

- The home page loads over HTTPS.
- `https://vote.example.com/api/relay` shows `"ok":true` and `"low":false`.
- Connect the organiser wallet, create an election, register through the QR and cast a test vote.

## Updating

Upload or `git pull` the new code, then **Container Manager -> Project -> veratalley -> Action ->
Build**. After changing `.env`, use **Action -> Stop**, then **Start** (rebuild if you changed a
`NEXT_PUBLIC_*` value).

## Safety notes

- Do not forward router ports or expose the DSM login page to the internet. Turn on 2-factor
  authentication for DSM and keep it updated.
- Run one app container only. Do not scale it up.
- The relayer key lives on this NAS. Keep only a small balance in that wallet.
- Registrations are personal data stored unencrypted in the data folder. Back the folder up,
  restrict who can open it, and purge registrations after the event from the organiser panel.
- Restrict your RPC provider key to your domain in the provider's dashboard.
- A power or internet outage takes voting offline. A UPS and a wired connection help.
- If you add another reverse proxy between Cloudflare and the app, set `TRUSTED_PROXY_HOPS=2`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Site shows a Cloudflare 502/1033 error | The tunnel container is not running or the token is wrong; check its log |
| Tunnel is up but the page is a 502 | The public hostname URL must be exactly `app:3000` (HTTP) |
| Registrations vanish or saving fails | Check `PUID`/`PGID` and that `DATA_HOST_PATH` exists and is writable by that user |
| "This server has no organiser wallets set up" | Set `NEXT_PUBLIC_ORGANISER_WALLETS`, then rebuild |
| `/api/relay` shows `ok:false` | `RELAYER_PRIVATE_KEY` or `NEXT_PUBLIC_RPC_URL` is missing or wrong |
| Build is killed or very slow | Not enough free memory; stop other containers during the first build |
