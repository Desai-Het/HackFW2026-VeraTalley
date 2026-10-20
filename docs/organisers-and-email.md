# Organisers, sign-in and email setup

## Who does what

| Person | Signs in? | What they do |
| --- | --- | --- |
| **Owner** (you) | Yes, with `OWNER_USERNAME` / `OWNER_PASSWORD` | Creates logins for organisers, watches the server wallet balance, can manage every election |
| **Organiser** | Yes, with the login the owner gave them | Creates elections, shares the QR code, invites voters, opens and closes voting |
| **Voter** | No | Scans the QR code to register, or opens the link in their email, then votes |

Nobody needs a crypto wallet. The server wallet pays for everything.

## One-time setup (owner)

1. Set `OWNER_USERNAME` and `OWNER_PASSWORD` (12+ characters) in `frontend/.env.local` or in your
   host's environment settings, then restart or redeploy.
2. Make sure `RELAYER_PRIVATE_KEY` is set. That wallet is the "server wallet": it creates and runs
   every election and pays the fees. Keep a little test POL in it.
3. Open `/login`, sign in, open **Accounts**. It shows the server wallet's public address and
   balance. Put that address in `NEXT_PUBLIC_ORGANISER_WALLETS` (it is built into the site, so
   rebuild/redeploy after changing it). On the local chain you can leave it empty.
4. On **Accounts**, add an organiser: pick a username and use the generated password. The password
   is shown once; send it privately. Organisers can change it on **My elections**.
   Use **Reset password** if one is lost, **Switch off** to end someone's access immediately.

## Running an election (organiser)

1. Sign in, click **Create election**, enter a title and candidates.
2. On the election page, under **Manage this election**:
   - **Collect registrations**: switch registration on, then show the QR code or share the link.
     People register with name and email, **no login**. Approve them and load them into the invite box.
   - **Add voters**: paste emails (or wallet addresses) and send invitations.
   - **Open voting** when ready, **Close voting** at the end.
3. Share the election page link so people can follow the live result and verify it.

Elections can only be managed by the organiser who created them (and the owner).

## Email setup (invitation links)

Without email, set `INVITE_DELIVERY=links`: the organiser gets each voter's link on screen and as a
CSV, and sends them some other way. To have the site email them:

1. Create an account at <https://resend.com>.
2. **Domains** -> **Add domain** (a domain you own, e.g. `example.com`). Add the DNS records Resend
   shows (SPF, DKIM) at your DNS provider and wait until it says **Verified**. Without a verified
   domain Resend only lets you send to your own address.
3. **API Keys** -> **Create API key** (sending access). Copy it once.
4. Set these where the app runs:

   ```dotenv
   INVITE_DELIVERY=email
   RESEND_API_KEY=<the key>
   EMAIL_FROM="VeraTalley <voting@example.com>"
   PUBLIC_BASE_URL=https://your-real-site-address
   ```

   `EMAIL_FROM` must use the verified domain. `PUBLIC_BASE_URL` is the address put in the links.
5. Restart/redeploy, create a test election, invite your own email and check the message arrives
   (also check spam the first time).

Troubleshooting: "Failed to send" means the key or sender domain is wrong; look at the server log.
The page lists a result for each address.

## Security notes

- Passwords are stored as salted scrypt hashes; five wrong tries lock that user from that network for 15 minutes.
- Back up `DATA_DIR` (it holds `accounts.json` and registrations).
- Do not reuse the owner password anywhere else. Changing `OWNER_PASSWORD` and restarting signs the owner out everywhere.
- Elections made earlier from MetaMask stay public and verifiable but cannot be managed from the site.
