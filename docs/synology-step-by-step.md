# VeraTalley on the Synology NAS: complete step-by-step guide

Written for someone who has never set up a server. Follow the steps in order and do not skip any.
Expect about 1.5 hours the first time, most of it waiting for the build to finish.

Screens in Synology and Cloudflare change slightly between versions. If a button is named a little
differently, pick the closest match. If you are stuck, stop and ask; nothing here is dangerous to
retry.

---

## Part A: What the developer Dhruv must hand over first

The NAS owner should not have to invent any of these. Before starting, you need:

| # | Item | What it looks like |
| --- | --- | --- |
| 1 | The finished `.env` file (a settings file with secrets) | A file called exactly `.env` |
| 2 | The repository code | A ZIP downloaded from GitHub (Part B, step 3) |
| 3 | The domain name to use | For example `vote.example.com` |
| 4 | Access to the Cloudflare account that controls that domain | Login email and password |
| 5 | Confirmation that the relayer wallet has test coins | "Funded, 0.3 POL" |

**Security rule:** the `.env` file contains passwords. Send it privately (not in a group chat, not by
plain email), never post it anywhere public, and delete the copy from Downloads when finished.

### How the developer prepares the `.env` file

1. Open `deploy/synology/.env.example` from the repository.
2. Save a copy named `.env` (on Windows Notepad: File -> Save As, type the name in quotes as
   `".env"`, and set "Save as type" to "All files").
3. Fill in every value as described in the file. Leave `PUID`, `PGID` and `CLOUDFLARE_TUNNEL_TOKEN`
   for now; Part B tells you the numbers to fill in.
4. Make sure `PUBLIC_BASE_URL` is the exact address people will visit, starting with `https://`.

---

## Part B: Steps for the NAS owner

### Step 1. Check the NAS can do this

1. Open a browser on any computer on the same network and go to the NAS's address (for example
   `http://192.168.1.50:5000`, or Synology's `find.synology.com`). Sign in with an administrator
   account.
2. Open **Control Panel -> Info Center -> General**. Check that **DSM version** starts with **7.2**
   or higher. If it is lower, open **Control Panel -> Update & Restore** and install the update first.
3. Open **Package Center**, search for **Container Manager**. If it says **Installed**, continue. If
   it says **Install**, click it and wait until it finishes.
4. Open **File Station**. On the left there should be a shared folder called **docker**. If it is
   missing, it will be created in the next step.
5. Make sure the NAS has some free memory: open **Resource Monitor** and check that at least 2 GB
   of memory is free. Close or stop other heavy apps during the first build if not.

### Step 2. Create the folders

In **File Station**:

1. If there is no `docker` folder, open **Control Panel -> Shared Folder -> Create** and create a
   shared folder named `docker`. (Container Manager normally creates it for you.)
2. Open `docker`. Click **Create -> Create folder** and name it `veratalley`.
3. Open `veratalley` and create two folders inside it: `repo` and `data`.

You now have:

```
docker / veratalley / repo     (the code goes here)
docker / veratalley / data     (saved registrations go here; leave empty)
```

### Step 3. Get the code onto the NAS

1. On your computer, open the project's GitHub page in a browser and sign in if it is private.
2. Click the green **Code** button, then **Download ZIP**.
3. In File Station, open `docker / veratalley`. Click **Upload -> Upload - Skip** and choose the ZIP.
4. When the upload finishes, right-click the ZIP and choose **Extract -> Extract here**.
5. You will get a folder named something like `HackFW2026-VeraTalley-main`. Open it. It must contain
   files such as `Dockerfile`, `package.json` and folders `frontend` and `deploy`.
6. Move everything inside that folder into `docker / veratalley / repo`. (Select all items inside,
   then drag them onto `repo`, or right-click -> Move to.) Afterwards `repo` itself must directly
   contain `Dockerfile`, `package.json`, `frontend`, `contracts` and `deploy`.
7. Delete the now-empty extracted folder and the ZIP.

Check: `docker / veratalley / repo / Dockerfile` exists. If you see an extra folder level, you moved
the wrong thing; redo step 6.

### Step 4. Find two numbers about your NAS user

The app needs to know which NAS user may write to the `data` folder. These are the numbers called
`PUID` and `PGID`.

1. Open **Control Panel -> Terminal & SNMP -> Terminal** tab, tick **Enable SSH service**, keep port
   22, and click **Apply**.
2. On Windows open **PowerShell**; on a Mac open **Terminal**. Type, replacing `youradminname` with
   your NAS administrator name and `NAS-IP` with the NAS address (like `192.168.1.50`):

   ```
   ssh youradminname@NAS-IP
   ```

   Type your NAS password (nothing appears while typing; that is normal) and press Enter. If it asks
   "Are you sure you want to continue connecting?" type `yes`.
3. Type this and press Enter:

   ```
   id youradminname
   ```

   You will see something like `uid=1026(admin) gid=100(users) ...`. Write down the number after
   `uid=` (this is PUID) and the number after `gid=` (this is PGID).
4. Type `exit` and press Enter.
5. Go back to **Control Panel -> Terminal & SNMP** and **untick Enable SSH service**, then Apply.
   (Leaving it on is a security risk.)

Do not want to use SSH? Ask the developer to set both to `0`. It works, but is less tidy.

### Step 5. Create the Cloudflare tunnel (this makes the site reachable from the internet)

You need the domain to be managed in Cloudflare. If the developer says it already is, skip to 5.2.

**5.1 Add the domain to Cloudflare (only if not already done)**
1. Go to `https://dash.cloudflare.com` and sign in (or create a free account).
2. Click **Add a domain**, type the domain (for example `example.com`), choose the **Free** plan.
3. Cloudflare shows two "nameservers". Sign in where the domain was bought (GoDaddy, Namecheap,
   Google Domains, etc.), find the domain's **Nameservers** setting, and replace the existing ones
   with the two Cloudflare gives you. This can take from a few minutes to a few hours.
4. Wait until Cloudflare shows the domain as **Active**.

**5.2 Create the tunnel**
1. In the Cloudflare dashboard, open **Zero Trust** (left menu). The first time, it asks you to
   choose a team name and the **Free** plan. It may ask for a payment card but charges nothing on
   the free plan.
2. Go to **Networks -> Tunnels** and click **Create a tunnel**.
3. Choose **Cloudflared**, click **Next**, name it `veratalley`, and click **Save tunnel**.
4. On the next page, choose the **Docker** option. Cloudflare shows a command that contains a very
   long text after `--token`. Copy **only the long token text** (it starts with `eyJ`) and keep it
   private. Do not run the command.
5. Click **Next**. Under **Public hostname**, fill in:
   - **Subdomain:** `vote` (or whatever the developer chose)
   - **Domain:** select the domain
   - **Service Type:** `HTTP`
   - **URL:** `app:3000`   (type exactly this)
6. Click **Save tunnel**.

### Step 6. Put the settings file in place

1. Open the `.env` file the developer gave you in Notepad/TextEdit.
2. Find these lines and fill them in:
   - `CLOUDFLARE_TUNNEL_TOKEN=` paste the long token from Step 5.2 right after the `=`, with no
     spaces and no quotes.
   - `PUID=` and `PGID=` the two numbers from Step 4.
   - `DATA_HOST_PATH=/volume1/docker/veratalley/data` leave as is (if your storage is not volume 1,
     change `volume1` to the correct one; it is shown at the top of File Station's folder path).
3. Save the file. Make sure the name is exactly `.env` (starting with a dot, with no `.txt` on the
   end).
4. In File Station, open `docker / veratalley / repo / deploy / synology` and upload the file with
   **Upload -> Upload - Overwrite**.
5. Check it arrived. Files starting with a dot are hidden by default. If you cannot see `.env`,
   click the **Settings** gear in File Station and tick the option to show hidden files and folders.
   If the upload will not accept the name, upload it as `env.txt` and then right-click -> **Rename**
   to `.env`.

Treat this file like a password. Do not share the folder. Delete your own copy from Downloads.

### Step 7. Start the app

1. Open **Container Manager** from the DSM main menu.
2. Click **Project** in the left list, then **Create**.
3. **Project name:** `veratalley`
4. **Path:** click **Set Path**, browse to `docker / veratalley / repo / deploy / synology`, and
   select it. Click **Select**.
5. **Source:** choose **Use existing docker-compose.yml**. If it asks whether to overwrite, choose
   to use the existing file.
6. Click **Next**. Skip any web-portal page. Click **Next**, then **Done**.
7. The project now builds. **This takes 5 to 15 minutes.** Leave the page open. Do not turn off the
   NAS. When it finishes, the project shows status **Running** and two containers are listed:
   `app` and `tunnel`.

If the build fails, see "If something goes wrong" below.

### Step 8. Check that it works

1. In **Container Manager -> Container**, both `veratalley-app-1` and `veratalley-tunnel-1` should
   say **Running**. After about a minute the app should also show **healthy**.
2. On any computer or phone (the phone can be on mobile data), open
   `https://vote.example.com` (the real address). The VeraTalley home page should appear with a
   padlock in the address bar.
3. Open `https://vote.example.com/api/relay`. You should see text like `"ok":true`. If it shows
   `"low":true`, the relayer wallet needs more test coins; tell the developer.
4. Ask the developer to run a full test: create an election, scan the registration QR with a phone,
   vote, and check the result.

If steps 2 to 3 work, the setup is complete.

### Step 9. Make it survive power cuts

1. In **Container Manager -> Container**, click `veratalley-app-1`, then **Settings** (or **Edit**),
   and make sure **Enable auto-restart** is ticked. Do the same for `veratalley-tunnel-1`. (This
   project is already set to restart automatically, so it is usually ticked.)
2. Optionally plug the NAS into a UPS (battery backup) so a short power cut does not turn it off.
3. Test once: restart the NAS from **DSM -> Power icon -> Restart**, wait about 5 minutes and open
   the site again.

---

## Part C: Day-to-day

**Update to a new version of the code**
1. Download the new ZIP as in Step 3 and upload it. Extract it.
2. Move its contents into `repo`, choosing to **overwrite**. Do NOT delete or overwrite
   `deploy/synology/.env`, and do not touch the `data` folder.
3. In Container Manager -> Project -> `veratalley`, click **Action -> Build**, then wait for it to
   finish.

**Change a setting**
1. Edit `.env` (re-upload with Overwrite).
2. Container Manager -> Project -> `veratalley` -> **Action -> Stop**, then **Action -> Build**
   (use Build, not just Start, if any `NEXT_PUBLIC_...` line changed).

**Look at logs when something is wrong**
Container Manager -> Container -> click `veratalley-app-1` -> **Log** tab. Copy the last 30 lines to
the developer.

**Backups and cleanup**
- The `data` folder holds people's names and emails. Include it in your normal NAS backup, and ask
  the developer to purge registrations from the organiser page after the event.
- Do not forward ports on the router and do not open the NAS login page to the internet. This setup
  needs neither.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Build fails or stops partway | Check free memory (Step 1.5), then Project -> Action -> Build again |
| Build says it cannot find `Dockerfile` | The files are one folder too deep; redo Step 3.6 |
| Build says `.env` or a variable is missing | `.env` is not in `deploy/synology` or has the wrong name (Step 6.5) |
| Site shows "Bad gateway" / error 502 or 1033 | The `tunnel` container is stopped, or the token is wrong; check its Log |
| Site shows 502 but tunnel is running | In Cloudflare the tunnel's public hostname URL must be exactly `app:3000` with type HTTP |
| Page loads, but `/api/relay` shows `"ok":false` | A wallet or provider address in `.env` is wrong; send the app Log to the developer |
| Page loads, but registration or voting says the server has no organiser wallet | `NEXT_PUBLIC_ORGANISER_WALLETS` is missing in `.env` (it must be the server wallet's public address); fix it and Build again |
| Sign-in says the site is not set up | `OWNER_USERNAME` or `OWNER_PASSWORD` is missing in `.env` (password 12+ characters); fix it and restart |
| Registrations disappear after a restart | `PUID`/`PGID` wrong or the `data` folder is missing; fix and Build again |
| Domain does not open at all | Cloudflare does not yet show the domain as Active (Step 5.1), or the hostname was not saved (5.2.6) |

## Quick reference

- Code folder: `docker / veratalley / repo`
- Settings file: `docker / veratalley / repo / deploy / synology / .env`
- Saved registrations: `docker / veratalley / data`
- App address inside the tunnel: `app:3000` (HTTP)
- Only one copy of the app may run. Never start a second one.
