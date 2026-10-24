# Hosting a TerraGlide server

TerraGlide plays alone in your browser with nothing but the page. To fly with
other people you need a **server**: one small program that everybody's game
connects to. This guide takes you from "I have never hosted anything" to a
server on the internet with its own address, step by step, and documents
every setting, command and rule along the way.

If you only read one part, read [Quick start](#quick-start-on-your-own-computer)
and then [Over the internet with a tunnel](#over-the-internet-with-a-tunnel-easiest):
together they get friends anywhere in the world flying with you in about ten
minutes, for free, without touching your router.

**Contents**

- [What the server is](#what-the-server-is)
- [The public server](#the-public-server)
- [Quick start on your own computer](#quick-start-on-your-own-computer)
- [Friends on the same wifi](#friends-on-the-same-wifi)
- [Over the internet with a tunnel (easiest)](#over-the-internet-with-a-tunnel-easiest)
- [Your own domain with Caddy](#your-own-domain-with-caddy)
- [Cloud hosting](#cloud-hosting): [Render](#render), [Fly.io](#flyio),
  [a VPS](#a-vps-ubuntu), [Docker](#docker)
- [Joining from the published game and the single files](#joining-from-the-published-game-and-the-single-files)
- [Configuration](#configuration)
- [Accounts and security](#accounts-and-security)
- [Commands and rules](#commands-and-rules)
- [Voice chat](#voice-chat)
- [Worlds](#worlds)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Publishing and credit](#publishing-and-credit)
- [Checking it works](#checking-it-works)

---

## What the server is

- **One Node.js process, nothing to install.** The server is the `server/`
  folder of this repository and uses only Node's standard library — even the
  WebSocket code is its own. There is no `npm install`, no database and no
  build step you have to remember.
- **One port for everything.** The same port serves the game itself (open the
  server's address in a browser and you are playing on it) *and* takes the
  game's WebSocket connection at `/ws`. Port 8080 unless you choose another.
- **It keeps what matters.** Accounts, sessions, where everyone is on every
  world, what they have explored, their trails, waypoints, landers, health,
  kills and deaths. All of it is plain JSON in `server/data/`, which you can
  open, read, back up by copying, and fix by hand.
- **It is the referee.** The page does the flying, because only the page has
  the ground to collide with. The server decides everything that would be a
  cheat if the page decided it: whether a move was possible, every sword hit,
  every teleport, health, and what counts as explored.
- **The game bundle is built on first run.** The page loads one
  `terraglide.bundle.js` rather than a hundred modules. It is a build output
  and not stored in git, so the first time the server starts it builds it
  (`Building the game bundle (first run only)…`, a second or two).
- **It also answers two small addresses** for monitoring:
  `/healthz` replies `ok`, and `/api/status` replies with the server's name,
  message, how many are online and whether it needs a join code — handy for an
  uptime checker, and safe for anyone to read. The game's startup screen asks
  the main lobby's `/api/status` every two seconds while it is open, for the
  lobby's up-or-down light, player count and ping. A page that has signed in
  there before sends its session token as the body of a `POST` to the same
  address and gets `friends: {online, total}` as well — counts only, no names;
  the session is looked at, not refreshed, and each account's friend list is
  read from disk at most once a minute.

What it needs: a computer that stays on while people play, Node.js 18 or newer
(22 is what this guide and the Docker image use), and about 100 MB of memory.
A Raspberry Pi is plenty for a group of friends.

---

## The public server

The game is built for **one public server that everybody plays on**, the
main lobby: every time the game starts it asks *Play locally* or *Play online
with everyone*, and online goes straight there. The Online panel offers it
first too, as one button — *Play on the public server* — and everything
anybody explores there is uncovered on everybody's map, kept on the server's
disk for good (`shared-<world>.json` in its data folder), with the share of the
whole Earth and of its land explored between everybody counted live at the top
of the world map.
Until step 3 below is done the startup screen says the main lobby is not open
yet, and only *Play locally* works from it. A server's own page (its address
in a browser) is always that server's lobby. Private
servers for a group of friends still work exactly as below; the public one is
just the one the published game points at.

Running it is one deploy and one setting — in this order:

1. **Deploy a server that stays up and keeps its disk.** [Fly.io](#flyio) is
   the best fit (a volume for the data; `fly.toml` here is ready). Render's
   free plan is not: it forgets every account whenever it sleeps — use a paid
   instance with a disk if you prefer Render. Give it a name people will see:
   `TERRAGLIDE_NAME="TerraGlide"`.
2. **Make yourself its admin, before anybody else can find it.** Open
   `https://<your-app>.fly.dev` and make your account: on a fresh server the
   first account made is an admin. Do this *before* step 3 — once the game
   points at the server, whoever signs up first gets it. (Or set
   `TERRAGLIDE_ADMINS=yourname` and make that account straight away, for the
   same reason.) As admin you can kick, ban and move the spawn.
3. **Point the game at it.** On GitHub, open the repository's *Settings →
   Secrets and variables → Actions → Variables* and add
   `TERRAGLIDE_PUBLIC_SERVER` = `wss://<your-app>.fly.dev/ws`. The next
   publish of the site (any push to `main`, or *Actions → Deploy to GitHub
   Pages → Run workflow*) builds that address into every copy of the game.
   Without GitHub, put the same address in `src/net/publicServer.js` and
   rebuild — `npm run build` (or `node tools/bundle.mjs && node tools/online.mjs`)
   — because the page loads the built bundle, not the file you edited.
4. **Keep the server in step with the site.** Every push to `main` publishes
   the game again, but the server only changes when you deploy it. When a
   change touches `server/` or `src/net/protocol.js`, run `fly deploy` too;
   a game and a server that disagree on the protocol tell players to reload.

Settings that suit a public server: leave `openSignups` on and `joinCode`
empty; keep `signupsPerHour` low (5) so nobody fills the account list;
`maxPlayers` as high as the machine takes (a shared-cpu 256 MB machine is
comfortable to about 50; give it 512 MB and raise it for more). Memory
follows who is *online*, not how many accounts have ever been made: an
offline player is a line of a few dozen bytes in a small index
(`index.json`, beside their records), and their whole record is only read
while they play or while somebody opens their map. Measured with 3,000 saved
players who had each explored 60 km: about 75 MB on start and 130 MB with
players signing in. The shared explored map grows with play rather than with
players — a small entry for each patch of ground explored — and a big one
(over a hundred hours of people gliding about) is under 10 MB. On Fly these
live on the 1 GB volume, which they will not fill for a long time.

Add a [TURN server](#when-people-cannot-hear-each-other-turn) so voice works
for everyone. The server is built to stay steady with a crowd: players far
from you are sent less often once a world has more than 64 people,
everybody's discoveries go out as one shared map rather than one per player,
big maps are sent in paced parts so nobody's connection is overwhelmed, and
a client that stops reading is let go before what waits for it piles up (see
[Rate limits](#rate-limits)).

---

## Quick start on your own computer

**1. Install Node.js.** Download the LTS version from <https://nodejs.org> and
run the installer. Check it worked by opening a terminal (Windows: PowerShell;
macOS: Terminal; Linux: any) and typing:

```sh
node --version
```

Anything from `v18` up is fine.

**2. Get TerraGlide.** Either with git:

```sh
git clone https://github.com/Eabusham2/terraglide.git
cd terraglide
```

or on the GitHub page press **Code → Download ZIP**, unzip it, and open a
terminal in the unzipped folder (on Windows: open the folder, click the
address bar, type `powershell`, press Enter).

**3. Start the server.**

```sh
node server/server.mjs
```

You will see:

```text
TerraGlide server "TerraGlide server" is running.
  Play here:        http://localhost:8080
  Others connect:   ws://<this machine's address>:8080/ws  (wss:// behind HTTPS)
  Data is saved in: /…/terraglide/server/data
Press Ctrl+C to stop.
```

**4. Play.** Open <http://localhost:8080>. Because the server is serving the
game, the page knows to join it: you get the sign-in form straight away.
Choose **Make an account**. **The very first account made on a new server is
an admin**, so make yours first.

**5. Stop it** with `Ctrl+C` in the terminal, once, and wait for
`Saving and stopping…` — everything is written to disk before it exits.
(Pressing it a second time forces an exit without waiting.) The server also
saves on its own every thirty seconds.

**Another port.** If 8080 is taken, pick another:

| Shell | Command |
| --- | --- |
| macOS / Linux | `PORT=3000 node server/server.mjs` |
| Windows PowerShell | `$env:PORT = "3000"; node server/server.mjs` |
| Windows Command Prompt | `set PORT=3000` then `node server/server.mjs` |

Every setting can be given the same way, or kept in a file — see
[Configuration](#configuration).

> `npm start` is **not** the server: it runs `serve.mjs`, a static file server
> for playing alone. Always start the multiplayer server with
> `node server/server.mjs`.

---

## Friends on the same wifi

Everyone on your home network can join the server running on your computer.

**1. Find your computer's local address** (it usually starts `192.168.`,
`10.` or `172.`):

| System | How |
| --- | --- |
| Windows | Run `ipconfig` and read **IPv4 Address** under your Wi-Fi or Ethernet adapter. |
| macOS | Run `ipconfig getifaddr en0` (Wi-Fi is usually `en0`; try `en1` if that prints nothing), or System Settings → Wi-Fi → Details. |
| Linux | Run `hostname -I` (the first address), or `ip -4 addr`. |

**2. Let it through the firewall.** The first time the server starts:

- **Windows** asks whether to allow Node.js on networks — tick **Private
  networks** and allow. Make sure your Wi-Fi is set to *Private* (Settings →
  Network & internet → Wi-Fi → your network → Network profile type); a
  *Public* network blocks your friends. If you dismissed the prompt, run this
  in PowerShell *as administrator*:

  ```powershell
  New-NetFirewallRule -DisplayName "TerraGlide" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
  ```

- **macOS** asks whether `node` may accept incoming connections — choose
  **Allow**.
- **Linux** with ufw: `sudo ufw allow 8080/tcp`.

**3. Your friends open** `http://192.168.1.20:8080` (with your address) in
their browser. That is the whole of it: the page they get *is* the game, and
it joins your server. They can also type `192.168.1.20:8080` into the Online
panel (`K`) of a game they already have open.

**Voice on the local network is listen-only.** Browsers only lend a page the
microphone on a *secure* address: `https://…`, or `http://localhost` on the
same machine. On `http://192.168.1.20:8080` your friends can hear anyone whose
microphone works — you, on `localhost` — but cannot talk themselves. For
everyone to talk, give the server an https address: the
[Cloudflare quick tunnel](#cloudflare-quick-tunnel) below takes one minute and
works for people in the same room too.

If friends cannot connect at all, the network may block devices from talking
to each other (common on guest networks, hotels, schools and offices). Use a
tunnel instead.

---

## Over the internet with a tunnel (easiest)

A tunnel is a small program that gives the server on your computer a public
`https://` address, with no router settings, no port forwarding and no
certificate to manage. WebSockets go through it as they are, and because the
address is https, voice chat works for everyone.

### Cloudflare quick tunnel

Free, no account, an address in seconds.

**1. Install `cloudflared`:**

| System | Command |
| --- | --- |
| Windows | `winget install --id Cloudflare.cloudflared` |
| macOS | `brew install cloudflared` |
| Debian / Ubuntu | `curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb` |

(Other systems and Raspberry Pi builds:
<https://github.com/cloudflare/cloudflared/releases>.)

**2. Start the server** as usual, in one terminal: `node server/server.mjs`.

**3. Start the tunnel** in a second terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:8080
```

After a few seconds it prints a box containing an address like
`https://some-random-words.trycloudflare.com`. **That is your server.** Send
it to your friends; opening it is joining it. It also works from the
published game: `https://eabusham2.github.io/terraglide/?server=wss://some-random-words.trycloudflare.com`.

**4. Tell the server it is behind a tunnel.** Every connection now arrives
from the tunnel, on your own machine, so without this the server thinks all
your players are one person at `127.0.0.1` — and the per-address limits (five
new accounts an hour) and address bans apply to everybody at once. Create
`server/config.json` containing:

```json
{
  "trustProxy": true,
  "host": "127.0.0.1"
}
```

and restart the server. `trustProxy` makes it read each player's real address
from the `X-Forwarded-For` header the tunnel adds. `host: 127.0.0.1` makes it
accept connections only from this machine — that is, only through the tunnel
— so nobody on your network can connect around it with a made-up header.
(Leave `host` out if you also want people on your wifi to use
`http://192.168…:8080` directly; then anyone on your network could fake their
address, which on a home network is usually fine.)

The quick tunnel's address **changes every time you restart `cloudflared`**.
Accounts are on your server and survive that; players just sign in again with
their password, because a browser remembers its sign-in per address. For an
address that never changes, use a named tunnel.

### A permanent address: a named Cloudflare tunnel

You need a free Cloudflare account and a domain whose DNS is on Cloudflare
(a domain costs about the price of a pizza a year; Cloudflare sells them at
cost).

**The easy way, in the dashboard.** In the Cloudflare dashboard open
**Zero Trust → Networks → Tunnels** (Cloudflare moves this around; search the
dashboard for "Tunnels") and **Create a tunnel** of type *Cloudflared*. Give it
a name; the next page shows a command, `cloudflared service install <token>`,
for your system — run it and the tunnel starts with your computer from then
on. Then add a **public hostname**: subdomain `play`, your domain, service
type **HTTP**, URL **`127.0.0.1:8080`**. Your server is now
`https://play.example.com`.

**Or from the command line:**

```sh
cloudflared tunnel login                         # opens a browser; pick your domain
cloudflared tunnel create terraglide             # prints the tunnel's ID
cloudflared tunnel route dns terraglide play.example.com
```

Then write `~/.cloudflared/config.yml` (on Windows,
`%USERPROFILE%\.cloudflared\config.yml`):

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /home/you/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: play.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

and run `cloudflared tunnel run terraglide`. Keep the `trustProxy` /
`host` settings from step 4 above.

### Tailscale Funnel

If you already use [Tailscale](https://tailscale.com):

```sh
tailscale funnel 8080
```

The first time, it gives you a link to switch on HTTPS and Funnel for your
tailnet. Then it prints an address like
`https://your-machine.your-tailnet.ts.net` — share that. Add `--bg` to keep it
running after you close the terminal, and `tailscale funnel reset` to stop
it. Set `trustProxy` and `host` as for Cloudflare. (Without Funnel, friends
who are on your tailnet can join `http://100.x.y.z:8080` like a home network,
voice listen-only.)

### ngrok

```sh
ngrok config add-authtoken <the token from your ngrok dashboard>
ngrok http 8080
```

It prints an `https://….ngrok-free.app` address. The free plan shows visitors
a warning page before the game; have friends open the ngrok address itself
(click through once) rather than joining it from the published game, which
that warning page can get in the way of. Set `trustProxy` and `host` as for
Cloudflare.

---

## Your own domain with Caddy

The classic way, for a computer at home or any machine with a public address:
your router forwards web traffic to the computer, and
[Caddy](https://caddyserver.com) sits in front of the server, gets an HTTPS
certificate for your domain on its own and renews it forever. WebSockets pass
straight through it with no extra settings.

**1. Give the computer a fixed local address.** In your router's admin page
(usually <http://192.168.0.1> or <http://192.168.1.1>; the login is often on a
sticker on the router), find *DHCP reservation* / *static lease* and reserve
the computer's current address for it.

**2. Forward ports 80 and 443** (TCP) to that address — the router's *Port
forwarding* / *Virtual server* / *NAT* page. Caddy needs 80 to prove to the
certificate authority that you own the domain, and 443 for the game itself.

**3. Point a domain at your home.** Find your public address with
`curl https://ifconfig.me` (or any "what is my IP" site) and create an **A
record** for, say, `play.example.com` pointing at it. Home addresses change
from time to time; a free dynamic-DNS name such as
[DuckDNS](https://www.duckdns.org) (`yourname.duckdns.org`) follows the
changes for you.

> **Check you are not behind CGNAT.** If the "WAN" or "Internet" address your
> router shows is different from what `ifconfig.me` says (often it starts
> `100.64`–`100.127`), your provider shares one public address between many
> homes and port forwarding cannot work. Use a [tunnel](#over-the-internet-with-a-tunnel-easiest)
> instead — some providers also block ports 80 and 443 at home, with the same
> answer.

**4. Install Caddy.** Windows: download `caddy.exe` from
<https://caddyserver.com/download>. macOS: `brew install caddy`. Ubuntu/Debian:
see [the VPS steps](#a-vps-ubuntu) below.

**5. Write a `Caddyfile`** (no extension) — next to `caddy.exe` on Windows, or
`/etc/caddy/Caddyfile` on Linux:

```caddyfile
play.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

and run `caddy run` in that folder (Linux service: `sudo systemctl reload caddy`).

**6. Set `trustProxy` and `host`** in `server/config.json` exactly as in
[the tunnel section](#cloudflare-quick-tunnel), so the server sees players'
real addresses and only Caddy can reach it. Caddy replaces any
`X-Forwarded-For` a visitor sends with their real address, so the header the
server reads can be trusted.

Your server is now `https://play.example.com`.

**Already using nginx?** The equivalent `location` block — the two
`Upgrade`/`Connection` lines are what lets WebSockets through:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
}
```

(`$remote_addr` rather than `$proxy_add_x_forwarded_for`, so a visitor cannot
put a fake address at the front of the header.)

---

## Cloud hosting

A server in the cloud stays up when your computer is off. Four ways, from
fewest decisions to most control. All of them need your own copy of this
repository on GitHub (fork it, or push your clone) unless noted.

### Render

[Render](https://render.com) builds and runs the server from your GitHub
repository using the `render.yaml` blueprint at the top of this repository.

1. Sign in to <https://dashboard.render.com> with GitHub.
2. **New → Blueprint**, choose your copy of the repository, and **Apply**.
3. Render builds the bundle, starts `node server/server.mjs`, and gives you an
   address like `https://terraglide-xxxx.onrender.com`. That address is the
   game and the server; WebSockets work on it.

What the blueprint sets: no `npm install` (there is nothing to install), a
build of the two single-file pages, the start command, the `/healthz` health
check, Node 22, and `TERRAGLIDE_TRUST_PROXY=1` with
`TERRAGLIDE_PROXY_HEADER=cf-connecting-ip` (Render's proxy, with Cloudflare in
front of it, is in front of every connection, and both add hops to
`X-Forwarded-For` after the player's — so the player's address is read from
the header Cloudflare sets instead). Render supplies `PORT` itself.

**The free plan forgets everything.** A free Render service goes to sleep
after fifteen minutes without traffic — the next visitor waits up to a minute
while it wakes — and **its disk is wiped whenever it sleeps, restarts or
redeploys**, so every account and every player is lost each time. That is
fine for trying it out with friends for an evening. To keep them:

1. In `render.yaml`, change `plan: free` to a paid plan (`starter` is the
   smallest).
2. Uncomment the `disk:` block (a persistent disk mounted at `/var/data`) and
   the `DATA_DIR` variable that points the server at it — delete the `# ` (the
   hash and the one space after it) at the start of each of those lines, and
   the indentation comes out right.
3. Commit, push, and re-sync the blueprint (or change the same things in the
   dashboard: *Disks* and *Environment*).

Render only attaches disks to paid services, and a service with a disk runs as
a single instance and is briefly down during each deploy. That is exactly
right for this server — it is one process holding one world.

Put secrets — a join code, admin names, TURN settings — in the dashboard under
**Environment**, not in the file.

### Fly.io

[Fly.io](https://fly.io) runs the `Dockerfile` in this repository on a small
virtual machine near your players, with a volume for the data. It is paid
(pay as you go; a 256 MB machine and a 1 GB volume cost a few dollars a month
— check <https://fly.io/pricing>), and works from your local copy, so you do
not need the repository on GitHub.

1. Install `flyctl`: macOS `brew install flyctl`; Linux
   `curl -L https://fly.io/install.sh | sh`; Windows PowerShell
   `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`.
2. `fly auth signup` (or `fly auth login`).
3. Make the app — the name must be unique across Fly — and put the same name
   in the `app = "…"` line of `fly.toml`. Change `primary_region` to the
   region nearest your players (`fly platform regions` lists them):

   ```sh
   fly apps create your-name-terraglide
   ```

4. Make the volume, in the same region. Fly warns that a single volume means
   downtime if its host fails; for this server one is right (`-y` answers the
   warning for you):

   ```sh
   fly volumes create terraglide_data --size 1 --region lhr -y
   ```

5. Optional secrets — a join code, admin names, and the TURN settings for
   voice (see [Voice chat](#voice-chat)):

   ```sh
   fly secrets set TERRAGLIDE_JOIN_CODE=letmein TERRAGLIDE_ADMINS=YourName
   fly secrets set TURN_URL=turn:turn.example.com:3478 TURN_USERNAME=terraglide TURN_CREDENTIAL=…
   ```

6. Deploy as a single machine (`--ha=false` stops Fly adding a spare), and
   check there is exactly one:

   ```sh
   fly deploy --ha=false
   fly status
   fly scale count 1     # only if status shows more than one
   ```

   The first deploy builds the image on Fly's own builders, which takes a
   minute or two; later ones reuse most of it.

Your server is `https://your-name-terraglide.fly.dev`. For your own domain:
`fly certs add play.example.com` and follow what it says about DNS. Logs:
`fly logs`. To update, get the new version (`git pull`, or copy the files in)
and run `fly deploy --ha=false` again: the data is on the volume, so nothing
is lost.

What `fly.toml` sets: the volume mounted at `/data` and `DATA_DIR=/data`, so
data survives deploys and restarts (a fresh volume can arrive owned by root;
the image hands it to the server's own user when it starts — see
[Docker](#docker)); `TERRAGLIDE_TRUST_PROXY=1` with
`TERRAGLIDE_PROXY_HEADER=fly-client-ip`, so each player's real address comes
from the header Fly's edge sets (Fly adds its own hop to `X-Forwarded-For`
after the player's, so the last entry there is Fly, not the player); HTTPS forced;
a `/healthz` check; and **auto-stop** — the machine stops when nobody is
connected (it saves first) and the next visitor starts it again in a few
seconds. To keep it running all the time, set `auto_stop_machines = "off"`
and `min_machines_running = 1`.

**Only ever run one machine.** Each machine would be a separate server with
its own volume and its own accounts.

### A VPS (Ubuntu)

Any virtual server — Hetzner, DigitalOcean, Linode, OVH, an always-free Oracle
Cloud instance — or a Raspberry Pi at home. These steps are for Ubuntu 22.04
or 24.04 (Raspberry Pi OS is the same), logged in as a user with `sudo`.

**1. Node.js 22 and git:**

```sh
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

**2. A user for the server, and the game:**

```sh
sudo useradd --system --create-home --home-dir /srv/terraglide --shell /usr/sbin/nologin terraglide
sudo -u terraglide git clone https://github.com/Eabusham2/terraglide.git /srv/terraglide/app
sudo -u terraglide node /srv/terraglide/app/tools/bundle.mjs
```

**3. Settings** in `/srv/terraglide/app/server/config.json` (create it with
`sudo -u terraglide nano /srv/terraglide/app/server/config.json`). Keeping the
data outside the git checkout makes updating and backing up simpler:

```json
{
  "name": "My TerraGlide server",
  "motd": "TerraGlide by Eabusham2. Fly safe; /help lists the commands.",
  "host": "127.0.0.1",
  "trustProxy": true,
  "dataDir": "/srv/terraglide/data"
}
```

**4. A systemd service,** so it starts on boot and restarts if it ever
crashes. Create `/etc/systemd/system/terraglide.service`:

```ini
[Unit]
Description=TerraGlide multiplayer server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=terraglide
Group=terraglide
WorkingDirectory=/srv/terraglide/app
ExecStart=/usr/bin/node server/server.mjs
Restart=on-failure
RestartSec=5
# The server saves everything on SIGTERM before it exits.
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now terraglide
systemctl status terraglide        # should say active (running)
journalctl -u terraglide -f        # its log, live; Ctrl+C to leave
```

**5. Caddy in front, for HTTPS.** Point your domain's A record at the VPS's
address, then:

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Put the two-line site from [the Caddy section](#your-own-domain-with-caddy) in
`/etc/caddy/Caddyfile` and `sudo systemctl reload caddy`.

**6. Firewall:** only SSH and the web are open; the game's port stays private
behind Caddy.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

(Add the TURN ports from [Voice chat](#voice-chat) if you run coturn here too.)

### Docker

The `Dockerfile` makes an image with Node 22 on Alpine Linux, this repository,
and both single-file pages built in. Building it downloads nothing beyond the
Node image itself. It keeps its data in a volume at `/data`, exposes port 8080
and has a health check on `/healthz`. The server runs as the image's
unprivileged `node` user (id 1000): the container starts as root only long
enough to make sure `/data` belongs to that user — a host folder or a cloud
volume often arrives owned by root — and then switches to it.

```sh
docker build -t terraglide .
docker run -d --name terraglide --restart unless-stopped \
  -p 8080:8080 -v terraglide-data:/data terraglide
```

Open <http://localhost:8080>; `docker ps` shows `(healthy)` after half a
minute. `docker logs -f terraglide` follows the log. `docker stop terraglide`
saves and stops (the server handles the signal Docker sends).

**Settings** go in with `-e`, for example
`-e TERRAGLIDE_NAME="Friday Flights" -e TERRAGLIDE_JOIN_CODE=letmein -e TERRAGLIDE_TRUST_PROXY=1`.
For the settings that only a config file can hold, mount one:
`-v "$PWD/server/config.json:/app/server/config.json:ro"`. (A
`server/config.json` present when you build is copied into the image too —
fine for ordinary settings, but keep secrets in `-e` variables, never baked
into an image.)

**A folder instead of a named volume** works too:
`-v "$PWD/terraglide-data:/data"`. The container gives the folder and what is
in it to user id 1000 when it starts, so on the host it then belongs to
whoever has that id (usually the first user account on a Linux machine); read
it with `sudo` if that is not you. If you start the container with `--user`,
it skips that step and the folder must already be writable by that user.

**With Docker Compose**, a `compose.yaml` next to the `Dockerfile`:

```yaml
services:
  terraglide:
    build: .
    image: terraglide
    ports:
      - "8080:8080"
    volumes:
      - terraglide-data:/data
    environment:
      TERRAGLIDE_NAME: My TerraGlide server
    restart: unless-stopped
volumes:
  terraglide-data:
```

and `docker compose up -d --build`. Compose names the volume after the folder
(`terraglide_terraglide-data`), so where this guide says
`docker run --rm -v terraglide-data:/data terraglide …`, use
`docker compose run --rm terraglide …` instead, with the server stopped
(`docker compose stop` first, `docker compose start` after).

The container speaks plain http. Put Caddy, a tunnel or your platform's HTTPS
in front of it as above, and add `-e TERRAGLIDE_TRUST_PROXY=1` when you do.

---

## Joining from the published game and the single files

The server's own address is always the simplest way in. But people can also
join your server from the game they already use:

- **An invite link.** `https://eabusham2.github.io/terraglide/?server=wss://play.example.com`
  opens the published game and joins that server. The `?server=` part is
  remembered and then taken off the address, so reloading does not undo a
  later choice; `?local` goes back to playing alone.
- **The Online panel** — press `K` (or **Play online** in the toolbar), type
  the address, **Join server**. It accepts `wss://play.example.com`, the
  `https://play.example.com` you would paste from the address bar (the panel
  turns it into the WebSocket address), or a bare `play.example.com`. A bare
  local address such as `192.168.1.20:8080` is taken as plain `ws://`.
  Recently used servers are listed under the box.
- **Copying an invite.** Once signed in, the Online panel shows an invite link
  with a **copy** button: the server's own address when you are playing on
  its page, and a `?server=` link otherwise.

**Why https pages need `wss://`.** The published game is an `https://` page,
and browsers refuse to let a secure page open an insecure `ws://` connection
(they call it *mixed content*) — it fails before it starts, and the game says
*"This page is https, so it can only reach wss:// servers."* So the published
copy can join any server with an https address (every tunnel, Caddy, Render
and Fly above) but **not** a plain `http://192.168…` server on a home network;
for those, open the server's own page instead.

**The single-file downloads** —
[terraglide.html](https://eabusham2.github.io/terraglide/terraglide.html) and
[terraglide-online.html](https://eabusham2.github.io/terraglide/terraglide-online.html),
opened from your disk — are not https pages, so they can join both `ws://` and
`wss://` servers, through the Online panel or with `?server=` added to the
file's address.

Joining reloads the page as an online game. Your own offline save is kept
apart and untouched: what you explore on a server lives on the server.

---

## Configuration

Every setting has a sensible default; a server started with no configuration
at all is open to sign-ups, has PvP on, and serves the game on port 8080.

Settings come from three places, each overriding the one before:

1. the defaults built into `server/config.mjs`;
2. **`server/config.json`**, if it exists;
3. **environment variables** — last, because that is how cloud hosts hand a
   program its port.

To use a config file, copy the example and edit it:

```sh
cp server/config.example.json server/config.json
```

`server/config.example.json` lists every setting at its default. Your
`config.json` only needs the ones you change — `{ "pvp": false }` is a
complete file. It must be valid JSON: no comments, no trailing commas, double
quotes. A broken file stops the server at start with
`server/config.json is not valid JSON: …` rather than running with settings
you did not mean. Restart the server after changing it.

A good rule: **ordinary settings in `config.json`, secrets in environment
variables** (the join code, a TURN password), so the file can be shared or
committed without giving them away.

### Every setting

| Setting | Default | What it does |
| --- | --- | --- |
| `name` | `"TerraGlide server"` | The server's name, shown on the sign-in form, in the welcome line and in the Online panel. |
| `motd` | `"Fly safe. /help lists the commands."` | A line under the name: rules, a welcome, where your Discord is. Shown before sign-in and in chat on joining. |
| `host` | `"0.0.0.0"` | Which network interface to listen on. `0.0.0.0` is every IPv4 address; `127.0.0.1` only this machine (use it behind a tunnel or proxy on the same machine); `::` IPv6 as well on most systems. |
| `port` | `8080` | The port for the game and the WebSocket. |
| `dataDir` | `"data"` | Where accounts and players are saved. A relative path is relative to the `server/` folder, so the default is `server/data/`. |
| `maxPlayers` | `50` | Most people online at once. Past it: *"The server is full — try again in a bit"*. |
| `maxAccounts` | `0` | Most accounts the server will hold; `0` for no limit. |
| `openSignups` | `true` | Whether anyone can make an account. `false` freezes the list; existing accounts still sign in. |
| `joinCode` | `""` | If set, making an account needs this code — a private server for friends. Signing in to an existing account does not. |
| `signupsPerHour` | `5` | New accounts allowed per address per hour. Everyone behind one public address shares it — a household, a school, an office — so a class making accounts together from school needs it raised for the day (say `40`). `0` means no limit; to stop sign-ups altogether use `openSignups: false`. |
| `admins` | `[]` | Account names that are admins, e.g. `["Alex", "Sam"]` (any case). See the warning under [Admins](#admins). |
| `firstAccountIsAdmin` | `true` | Whether the very first account on a server with no accounts becomes an admin. |
| `pvp` | `true` | Whether players can hurt each other with swords. |
| `spawnProtectionM` | `64` | No fighting within this many metres of a world's spawn, measured along the ground, so new arrivals are not ambushed. |
| `rtpCooldownS` | `60` | Seconds between random teleports, per player. |
| `spawnCooldownS` | `15` | Seconds between uses of `/spawn`. |
| `maxSpeed` | `180` | Fastest allowed flight, metres a second, across the ground and upwards, before a move is refused. Falls never count. The fastest honest flight on rockets alone, a Rocket V held on a climb, is 143 m/s on Earth. On top of this the server allows whatever speed you have **fallen** for — every metre of a fall it saw adds to the limit, every metre you climb takes it back, and air takes it away over a few seconds, as it does in the game; with no air (the Moon, Mercury…) it stays for as long as you are actually flying that fast, because nothing in the game slows you there either — and the speed a surge with rockets lit leaves you with on an airless world. During a surge the limit is 5.5 times this — a surge stretches every tick 2.4 times *and* a rocket's push with it, so a Rocket V in a surge climbs at about 870 m/s — and the server holds surges to the game's own twelve seconds on and thirty to recharge, so a page cannot simply claim to be surging. On thin-air worlds, where a glide can reach the world's terminal speed, the limit is raised to 1.3 times that if it is higher — about 490 on Mars; a surge stretches that glide only as it stretches every tick, 2.4 times (about 1,180 on Mars), and a fall there gives no more speed than the glide, since the air holds a faller to it. On foot the limit is 25 m/s (a sprint is under 6), 60 in a surge. `node tools/flightcheck.mjs` flies every world with the game's own flight model against all of this. |
| `allowedOrigins` | `"*"` | Which web pages may connect: `"*"` for any, or a list such as `["https://play.example.com", "https://eabusham2.github.io", "null"]`. `"null"` is the single-file game opened from disk. If you restrict it, include your server's own public address or its own page cannot connect. |
| `iceServers` | Google's public STUN | The servers browsers use to connect voice chat. Add a TURN server here (or with `TURN_URL`) when some players cannot hear each other — see [Voice chat](#voice-chat). Standard WebRTC format: `[{ "urls": [...], "username": "...", "credential": "..." }]`. |
| `serveGame` | `true` | Serve the game on the same port. `false` makes the server WebSocket-only (plus `/healthz` and `/api/status`); players then join from the published game. |
| `trustProxy` | `false` | Read the player's address from what the proxy reports — the **last** entry of `X-Forwarded-For`, the one the proxy added, or `proxyHeader` if set. Without it, behind a tunnel or proxy every player looks like the proxy — `127.0.0.1` for a tunnel on the same machine — and they all share one set of rate limits and bans. Turn on **only** behind a tunnel or reverse proxy; directly on the internet it would let anyone claim any address. |
| `proxyHeader` | `""` | With `trustProxy` on, a header your proxy names the visitor in, which then wins over `X-Forwarded-For` — `"cf-connecting-ip"` behind Cloudflare. Leave it empty anywhere else: a header your proxy does not set, anyone can send. |
| `saveEveryS` | `30` | Seconds between saves to disk. Everything is also saved when a player leaves and when the server stops. |

### Environment variables

| Variable | Sets | Notes |
| --- | --- | --- |
| `PORT` | `port` | Cloud hosts set this for you. |
| `HOST` | `host` | |
| `DATA_DIR` | `dataDir` | Use an absolute path, e.g. `/data` or `/var/data`. A relative one is relative to `server/`. |
| `TERRAGLIDE_NAME` | `name` | |
| `TERRAGLIDE_JOIN_CODE` | `joinCode` | |
| `TERRAGLIDE_ADMINS` | `admins` | Comma-separated: `Alex,Sam`. Replaces the list from the file. |
| `TERRAGLIDE_TRUST_PROXY` | `trustProxy` | `1` for on, `0` for off. **Any value other than `0` means on** — even `false`. |
| `TERRAGLIDE_PROXY_HEADER` | `proxyHeader` | e.g. `cf-connecting-ip`. |
| `TERRAGLIDE_MOTD` | `motd` | |
| `TERRAGLIDE_MAX_PLAYERS` | `maxPlayers` | A number. Anything else is ignored with a warning in the log. |
| `TERRAGLIDE_MAX_ACCOUNTS` | `maxAccounts` | A number; `0` for no limit. |
| `TERRAGLIDE_SIGNUPS_PER_HOUR` | `signupsPerHour` | A number. |
| `TERRAGLIDE_OPEN_SIGNUPS` | `openSignups` | `1`, `true`, `yes` or `on` for on; `0`, `false`, `no` or `off` for off. Anything else is ignored with a warning. |
| `TERRAGLIDE_FIRST_ACCOUNT_ADMIN` | `firstAccountIsAdmin` | As `TERRAGLIDE_OPEN_SIGNUPS`. |
| `TERRAGLIDE_PVP` | `pvp` | As `TERRAGLIDE_OPEN_SIGNUPS`: `TERRAGLIDE_PVP=0` turns sword damage between players off. |
| `TERRAGLIDE_ALLOWED_ORIGINS` | `allowedOrigins` | `*`, or a comma-separated list: `https://play.example.com,https://eabusham2.github.io,null`. |
| `TERRAGLIDE_CONFIG` | any setting | JSON, laid over `server/config.json` and under the variables above: `{"rtpCooldownS": 30, "spawnProtectionM": 100}`. For hosts that build from the repository, where `config.json` is not committed (Render, Fly from GitHub). |
| `TURN_URL` | adds to `iceServers` | One or more TURN addresses, comma-separated: `turn:turn.example.com:3478,turn:turn.example.com:3478?transport=tcp`. Added after the STUN servers, not instead of them. |
| `TURN_USERNAME` | | The TURN server's username. |
| `TURN_CREDENTIAL` | | Its password. |

### Examples

A private server for a group of friends, PvP off:

```json
{
  "name": "The Glider Club",
  "motd": "TerraGlide by Eabusham2. Friends only; ask Alex for the code.",
  "pvp": false,
  "maxAccounts": 20
}
```

and start it with the code as a secret:
`TERRAGLIDE_JOIN_CODE=blue-heron-42 node server/server.mjs`.

A public server behind Caddy, accounts closed after everyone has joined:

```json
{
  "host": "127.0.0.1",
  "trustProxy": true,
  "openSignups": false
}
```

---

## Accounts and security

### How accounts work

- **Names** are 3–16 letters, digits or `_`, unique regardless of case (`Alex`
  and `alex` are one account). `server`, `console`, `system`, `admin`,
  `terraglide`, `everyone` and `here` are reserved. Each account gets a colour
  of its own, as far from everyone else's as possible.
- **Passwords** are 6–128 characters and are **never stored**. The server keeps
  an scrypt hash with its own random salt — a memory-hard hash from Node's
  standard library that makes a stolen accounts file slow to attack — and
  checks it in constant time. Checking a name that does not exist costs the
  same as one that does, so timing reveals nothing.
- **Sessions.** Signing in gives the browser a random token so it does not need
  the password again. Only a hash of each token is stored. A session lasts 30
  days from its last use; an account can be signed in on 8 devices at once
  (the oldest is dropped). Signing in from a second place drops the first
  (*"Signed in from somewhere else"*). Changing your password — **Change
  password** in the Online panel (K), or `/password old new` — signs out your
  other devices; a reset or a ban signs out all of them.
- **The connection is only as private as its address.** On `https://` and
  `wss://` (every tunnel, Caddy, Render, Fly) passwords travel encrypted. On
  plain `http://` on a home network they do not — fine at home, not on a
  café's wifi.

### Rate limits

| What | Limit |
| --- | --- |
| New accounts | `signupsPerHour` (5) per address per hour |
| Sign-in attempts | 8 per address per 5 minutes; a successful sign-in starts the count again |
| Wrong passwords for one account | 5 per 15 minutes from one address, then that address waits. 30 an hour from anywhere, then only addresses that have not been getting it wrong may try — its owner signing in from home is not locked out by someone else guessing |
| Wrong current password when changing it | 5 per 15 minutes per account |
| Chat | 6 lines per 6 seconds per account, 256 characters each (commands count); reconnecting does not reset it |
| Gathering a party | Once per 10 seconds |
| Messages | 64 KB each; a client that stops reading is dropped past 2 MB of small messages (positions, chat) waiting in its connection — a big one on its way out, a map or a path, does not count — or 24 MB queued for it in all (big maps are sent a piece at a time, no faster than the connection takes them); a silent client is dropped after 45 seconds |
| Shared map | One player adds at most 150,000 cells a day to everybody's explored map — more than a whole day of flying flat out finds; past that what they explore is still on their own map. A world's shared map stops growing at 30 million cells |

A browser that is already signed in comes back with its saved session and
never touches the sign-in limits.

**"Per address" means per public address.** Everyone in one home, one school
or one office usually reaches the internet through a single public address,
so to your server they are one address: a group like that can make only
`signupsPerHour` new accounts an hour between them, and eight mistyped
passwords in five minutes make all of them wait. For a class or a club
signing up together, raise `signupsPerHour` for the day (and lower it again
after), or have people make their accounts at home. Friends on *your* wifi
joining `http://192.168…:8080` directly are not affected — each device has
its own local address.

**Behind a tunnel or proxy these need `trustProxy`.** Without it every player
arrives from the proxy — `127.0.0.1`, for a tunnel on the same machine — and
shares one limit — and a ban made while that player happened to be the only
one online would ban the proxy's address, which is everyone (see [Bans](#bans)).

They are a speed bump for casual abuse, not a wall: someone determined can
come from many addresses. What they cannot do is pick their address: a
visitor can start `X-Forwarded-For` with anything they like, so the server
reads the **last** entry — the one your proxy added — never the first. Behind
Cloudflare you can name its own header instead with `proxyHeader:
"cf-connecting-ip"` (or `TERRAGLIDE_PROXY_HEADER=cf-connecting-ip`); only do
that behind Cloudflare, because anyone can send that header to a server that
is not. Fly.io sets `fly-client-ip`, and the `fly.toml` and `render.yaml` here
already name the right header for their hosts.

### Private servers

- **A join code** (`joinCode` / `TERRAGLIDE_JOIN_CODE`): the sign-up form
  shows a *Join code* box, and an account cannot be made without the right
  code. Accounts that exist keep signing in without it, so you can change or
  remove the code at any time.
- **Close sign-ups** (`openSignups: false`) once everybody has an account.
- **Cap the accounts** with `maxAccounts`.

### Admins

Admins get the [admin commands](#commands-and-rules) and see them in `/help`.
Ways to make one:

- **The first account** on a new server, automatically (`firstAccountIsAdmin`).
- **The `admins` list** in `config.json` or `TERRAGLIDE_ADMINS`. Applied when
  they sign in. **Make the account before you list its name**: a listed name
  that does not exist yet makes whoever signs up with it first an admin.
- **From the command line**, for an existing account:

  ```sh
  node server/server.mjs --admin NAME
  ```

To take admin away, stop the server, set `"admin": false` for that account in
`server/data/accounts.json`, remove the name from `admins` if it is there, and
start the server again.

> **Run the command-line tools while the server is stopped.** A running server
> keeps every account in memory and writes them all to disk every thirty
> seconds and when it stops, so a change made to the file underneath it is
> overwritten within moments. Run them with the same settings as the server
> (same `config.json`, same `DATA_DIR`), or they change a different data
> folder.

### Resetting a password

```sh
node server/server.mjs --reset-password NAME NEWPASSWORD
```

It prints `Password for NAME reset; they have been signed out everywhere.` Tell
them the new password and ask them to change it with `/password`. The steps,
per kind of host, with the server stopped:

| Where | Steps |
| --- | --- |
| Your computer | `Ctrl+C` the server, run the command, start the server. |
| VPS (systemd) | `sudo systemctl stop terraglide`, then `sudo -u terraglide node /srv/terraglide/app/server/server.mjs --reset-password NAME NEWPASSWORD`, then `sudo systemctl start terraglide`. |
| Docker | `docker stop terraglide`, then `docker run --rm -v terraglide-data:/data terraglide node server/server.mjs --reset-password NAME NEWPASSWORD`, then `docker start terraglide`. |
| Render (paid, with a disk) | In *Settings*, change the start command to `node server/server.mjs --reset-password NAME NEWPASSWORD && node server/server.mjs` and deploy; when it is up, put the start command back. |
| Fly.io | `fly ssh console`, then `cd /app && DATA_DIR=/data node server/server.mjs --reset-password NAME NEWPASSWORD && kill -9 $(pidof node)`. Killing the server stops it saving over the change; Fly starts it again for the next visitor. The last half-minute of play may be lost. |

`--admin NAME` works the same way. A forgotten admin password is just a reset
of that account — or make another account an admin with `--admin`.

### Bans

`/ban NAME reason` (admins) bans the **account**, signs it out everywhere, and
if they are online kicks them and also bans the **address** they were
connected from, so a fresh account from the same place is refused too. It
works on offline accounts as well (account only). `/unban NAME` lifts both.
Bans are kept in `server/data/server.json`.

The address is left out when anybody else online is on the same one — a
shared home network, or a proxy the server cannot see past — and the ban says
so: banning it would ban them all. Admins are never refused for their address,
so a ban can never lock you out of your own server.

> Behind a tunnel or proxy **without** `trustProxy`, every player has the
> proxy's address. If an address ban has caught people it should not:
> `/unban` the player it came from (or delete the entry from `server.json`
> with the server stopped), then turn `trustProxy` on.

### What is stored, and what never leaves

```text
server/data/
  accounts.json         every account: name, colour, admin, password hash,
                        and the hashes of active sessions
  server.json           bans (with the banned address), spawn points moved
                        with /setspawn, and parties: their members, leader
                        and waypoints
  shared-<world>.json   everything anybody has explored on that world: the
                        shared map. Rebuilt from players/ if deleted
  index.json            a line per player: which worlds they have been on and
                        how much they explored there, read instead of their
                        files. Rebuilt from players/ if deleted
  players/<name>.json   one player: which world they are on, their health,
                        oxygen, rocket stock, kills, deaths and time played,
                        their friends and friend requests, and for every
                        world they have visited: where they are, what they
                        have explored, their trail, waypoints and lander
```

Every save writes to a temporary file and renames it over the old one, so a
crash or a power cut mid-save leaves the last good copy, never half a file.
(A leftover `*.tmp` is harmless.) If a file ever cannot be read, the server
does not overwrite it: it renames it to `<file>.broken-<time>` and carries on
without it — see [Troubleshooting](#troubleshooting).

**Never served:** the web side hands out only the game (`index.html`, the two
single files, the bundle, `src/`, `styles/`, `vendor/`, `assets/`) and the
documents (`LICENSE`, `README.md`, `THIRD-PARTY.md`, this file). Nothing in
`server/` — not the data, not `config.json` — and no hidden file is ever sent,
whatever address is asked for. Password hashes, session hashes and players'
addresses never leave the machine; the server's log does not print them.

**What players can see of each other:** names, colours, and position, health
and what they are holding for everyone on the same world; who is on which
world. Everything anybody has explored on a world is on everybody's map there
(the shared map, on by default), and anyone can switch on another player's
**trail** and own **explored ground** (players list, `Tab`), including
players who are offline — tell your players. Friends see when each other come
online and on which world. A party's members see each other's party waypoints
and hear each other on voice wherever they are. Personal waypoints are private. **Voice chat connects
browsers directly**, so the people you talk to can learn your IP address, as
with most voice chat.

**Do not commit `server/data/`** (or a `config.json` holding secrets) to git:
it contains every account's password hash.

### Backups

Copy the data folder. That is the whole backup.

On your own computer, copy the `server/data` folder somewhere safe — in your
file manager, or from the `terraglide` folder in a terminal:

```sh
tar czf terraglide-backup.tgz -C server data
```

```sh
# a VPS set up as above
tar czf terraglide-backup-$(date +%F).tgz -C /srv/terraglide data

# Docker: copy /data out of the container (running or stopped) into a folder
docker cp terraglide:/data ./terraglide-backup-$(date +%F)
```

Each file is always whole, so copying while the server runs is safe; for a
copy in which every file is from the same moment, stop the server first. To
restore: stop the server, put the folder back, start it (Docker:
`docker stop terraglide`, `docker cp ./terraglide-backup-DATE/. terraglide:/data`,
`docker start terraglide`). A nightly `cron` job on a VPS: `sudo crontab -e`
and add
`17 4 * * * tar czf /root/terraglide-$(date +\%a).tgz -C /srv/terraglide data`
(a rolling week of backups).

---

## Commands and rules

Commands are typed into chat (`T`, or `/` to start with a slash). `/help` lists
the ones you can use. Player names forgive case and can be shortened while the
start is unambiguous (`/tpa ale` for Alexandra).

### Everyone

| Command | What it does |
| --- | --- |
| `/help` | List the commands. |
| `/tpa <player>` | Ask to teleport to a player. |
| `/tpahere <player>` | Ask a player to teleport to you. `/tphere` works too. |
| `/tpaccept [player]` | Accept a teleport request — the newest, or the one from that player. |
| `/tpdeny [player]` | Refuse one. |
| `/tpacancel [player]` | Take back a request you sent. |
| `/tp <player>` | For players, the same as `/tpa`. For admins, see below. |
| `/msg <player> <message>` | Whisper to one player. Also `/w`, `/tell`. |
| `/r <message>` | Reply to whoever last whispered with you. |
| `/near <message>` | Say something only to players within 3 km of you on your world. Also `/l`, `/local`. |
| `/me <action>` | Describe what you are doing. |
| `/list` | Who is online, grouped by world. |
| `/spawn` | Go back to this world's spawn. Once every `spawnCooldownS` (15 s). |
| `/rtp` | Random teleport, to a place the server chooses: a populated place on Earth, a named feature elsewhere. Once every `rtpCooldownS` (60 s). |
| `/travel <world>` | Go to another world: `/travel moon`, `/travel mars`… Also `/planet`, `/world`. |
| `/kill` | Give up and respawn. |
| `/password <old> <new>` | Change your password; your other devices are signed out. For a password with spaces in it, use **Change password** in the Online panel (K) — the command only takes two plain words. |
| `/friend add <player>` | Ask to be friends — works for players who are offline too; they see it when they next sign in. Somebody who has *Accept friend requests automatically* on (Settings → Online) is your friend at once. `/friend <player>` does the same. Also `/friends`, `/f`. |
| `/friend accept [player]` / `/friend deny [player]` | Answer a friend request — the newest, or the one from that player. |
| `/friend remove <player>` | Take somebody off your list (or take back a request). |
| `/friend list` | Your friends, who is online and where, and who is asking. |
| `/party invite <player>` | Invite somebody to your party (starting one if you have none). Up to 8; an invite lasts 60 s. `/party <player>` does the same. Also `/p`. |
| `/party accept [player]` / `/party deny [player]` | Answer a party invite. |
| `/party leave` | Leave your party. The last but one leaving ends it. |
| `/party kick <player>` / `/party leader <player>` | Leader: remove somebody, or hand the party over. |
| `/party together on\|off` | Whether you teleport along when the leader does. On when you join. |
| `/party gather` | Leader: bring everyone with *together* on to where you are. |
| `/party mark [name]` / `/party unmark <name>` | A party waypoint where you stand, or remove one. |
| `/party list` | Who is in your party. |
| `/pc <message>` | Talk to your party only, wherever they are. |

### Admins

| Command | What it does |
| --- | --- |
| `/tp <player>` | Go straight to a player, no request — even on another world. |
| `/tp <player> <other>` | Send one player straight to another. |
| `/kick <player> [reason]` | Disconnect a player (they can come back). |
| `/ban <player> [reason]` | Ban an account (and, if online, their address); see [Bans](#bans). |
| `/unban <player>` | Lift a ban. |
| `/heal [player]` | Restore full health, to you or someone else. |
| `/setspawn` | Make where you are standing this world's spawn point. |
| `/say <message>` | An announcement to everyone, shown as `[YourName] message`. |

In the game, with the default keys (all can be changed in Settings):

- `T` opens chat and `/` opens it with a slash already typed.
- `Tab` is the players list: *TPA* (ask to go to them), *Bring* (ask them to
  come to you), *Msg* and, with voice on, *Mute* beside each name, plus the
  *trail* / *discovered* switches that put their line and their explored
  ground on your map — for everyone who has ever been on your world, online
  or not.
- `J` is the teleport menu: choose *TPA* or *TPA here*, type a few letters of
  a name, press Enter. Admins also get *TP* and *TP here*, which do not ask.
  It sends exactly the command you would have typed.
- `Y` / `N` accept or deny the newest teleport request.
- `R` is `/rtp` and `U` the world picker, the same as `/travel`.

### Teleport requests

A request waits **40 seconds** for an answer, then runs out and both sides are
told. One request between the same two people at a time — asking again
replaces it — and you can ask the same person again after 5 seconds. Accepting
puts the visitor just behind the host, at the host's height: someone flying at
2,000 m gets their visitor beside them in the air. Requests work between
worlds: accept one from the Moon and you are on the Moon.

### Fighting

- **PvP** is on unless `pvp` is `false`. Slot 6 is the sword; ten hearts
  (twenty half-hearts) is a life.
- **The server judges every hit**: the sword must be in hand, both players
  alive and on the same world, and the target within reach (3 m, plus a small
  allowance for network delay; the server rewinds the target to where the
  attacker saw them). Swinging before the sword has recharged (0.625 s) hits
  for less; a falling hit is a critical, half again as hard.
- **Spawn protection:** nobody can hurt or be hurt within `spawnProtectionM`
  (64 m) of a world's spawn.
- **Combat tag:** hitting or being hit by a player marks both of you as in a
  fight for **10 seconds**. While it lasts you cannot `/spawn`, `/rtp`,
  `/travel`, send a teleport request or be teleported by accepting one, and
  leaving the game — or `/kill` — counts as dying, with the kill going to
  whoever hit you last.
- **Health comes back** half a heart every 3 seconds once you have gone 8
  seconds without damage. Health is saved, so logging out does not heal you.
- **Death** is announced in chat. You respawn at the world's spawn — off Earth,
  at your lander if you have put one down — with three seconds of protection.

### Anti-cheat

Cheats are off on a server: the page disables the cheat panel, freecam, size
changes and pausing. The server does not take the page's word for anything
that matters:

- **Speed is checked.** Every move is measured against `maxSpeed` (5.5 times
  it during a surge, which the server times itself), across the ground and
  upwards — falls are free — with an allowance that absorbs a bad connection
  delivering updates in bunches, and that lends back the travel a connection
  held up when it stalls for up to ten seconds. On foot the limit is walking
  pace, 25 m/s (60 in a surge), from two seconds after landing. Height starts counting 30
  seconds after arriving somewhere, once the ground has loaded under you.
- **Speed you fell for is yours.** The limit goes up by what a fall the
  server saw could give you (2gh), and down again as you climb or the air
  takes it away — the game's own physics, kept as an account per player. It
  only counts a fall from a height the server accepted — one you climbed to
  at a pace a flight could; on arriving where the server sent you, no more
  than 300 m above it (the ground there may load in higher) and no higher
  than you (or whoever you were sent to) had earned and still have — a height
  climbed once and come down from is spent; on
  arriving with no height given (a respawn, a random teleport), up to a
  kilometre above the world's highest ground, since it cannot see the ground
  under you; never a height a page only claimed, however it was saved or
  passed on — and down to the world's lowest ground, no further. Landing
  clears it, and speed you are not using fades away.
- An impossible move is refused and the player is put back where they were;
  enough of them in a row disconnects them (*"Moving impossibly fast"*). A
  refused move is still counted as heard, so asking for more than the limit
  again and again gets no more than the limit.
- **No blinking into a fight.** The allowance lets a page that stood still
  for a moment spend it all at once, and a stall's travel is lent back when
  the connection recovers. Both are let through as movement, but a sword hit
  within 0.8 s of either — or of a refused move, or of a drop faster than you
  were already falling (five kilometres in one state onto somebody below), or
  of a rise the server let stand without judging it (the ground standing you
  up, on your feet or just after arriving) — does not count, whatever the
  page says it is doing — nor of getting further from where you were sent,
  in the first half second after arriving, than half a second at the limit
  carries you. Signing in again keeps the guard, and the sword's recharge,
  where they were. Moves a
  page sent before it could have heard it was put back — within 0.3 s plus
  its round trip, at most 1 s — are refused without counting against it.
- **Teleports are the server's.** The page is only ever moved somewhere the
  server sent it, and arrives exactly there — signing in again is an arrival
  too, at the spot it left from. One that says it is up to 400 m off across
  the ground, or at another height, is taken to be on the spot, and further
  off is put there; sent to stand on the ground, a page stands on the ground
  it has there, which may not have loaded yet, and getting from the spot to
  it is a move like any other. A page
  that never says it has arrived is put there anyway after 20 seconds, so
  "still on the way" is not a way to be untouchable. Nobody is sent to
  somebody still arriving — by `/tpa` or an admin's `/tp` (*"… has not
  landed yet"*), or gathered by a party leader who is (*"Land first"*): the
  height they were sent to is not yet one the server has seen them at.
- **Hits need a swing.** A hit counts only with the swing that made it, which
  every other player sees. How far back the target is rewound comes from the
  server's own measurement of the connection (WebSocket pings it sends and
  times itself; an answer to one it did not send is ignored, so a page can
  only make itself look slower by holding its answers back), and is at most
  0.4 s. The reach allowance for fast
  movement counts only speed across the ground, not falling.
- **Leaving a fight is losing it.** Closing the page — or `/kill` — while in a
  fight counts as dying, and the kill goes to whoever hit you last. You come
  back at the respawn and are told why. (Signing in again from another tab
  is not leaving, nor is the server restarting — but the fight goes with you,
  and its ten seconds wait while the new page is still arriving.)
- **Random teleports are chosen by the server** — a populated place on Earth, a
  named crater, mountain or plain elsewhere — so a page cannot "randomly"
  choose the spot it wanted.
- **Hits, damage and health** are decided by the server (above). The only
  damage a page reports itself — drowning, running out of oxygen — can only
  hurt the one reporting it, and no faster than the real thing.
- **Explored ground and trails** are worked out by the server from the moves it
  accepted, so a modified page cannot paint the map with places it never went.

**What it cannot check.** The server has no terrain, so it cannot tell
whether someone is really standing on the ground or hovering just above it,
or flying through a mountain: those are the page's to decide, and a modified
page can get them wrong on purpose (within the speed limits). Nor does it
hold a fall to the game's own pace: coming down is never refused, so a page
can drop faster than the game's air would let it - though not land a hit
from a sudden drop. Knockback is
applied by the page that is hit, so a modified page can ignore being
knocked back. Sent somewhere with no height given — a respawn, a random
teleport — a page can say it is standing on the highest ground that world has
and step off it into its deepest; arriving anywhere else, it can step off the
spot it was sent to (or up to 300 m above it) into the deepest ground. That is one fall's worth of
speed, more than any single spot really offers since the server cannot see
which spot it is — but one an arrival, however often it bounces, and it
fades away unless it is actually being flown. Except over a pause: a page in
a background tab stops the game and sends nothing, so a gap with nothing
arriving behind it, from a page not otherwise sending slowly, is left out —
all of it the first time in five seconds, and after that what is longer than
the second and a half a page flies on coming back — and a page that only ever
sends once a second keeps that speed for as long as it likes. How many rockets you have left
is counted by the page, but
however many you light the speed limit still holds. Players whose names
look alike (`Alex` and `AIex`) are different accounts — check the colour.
None of this lets anyone hurt somebody out of reach, go faster than the
game can, or see places they never went.

---

## Voice chat

Proximity voice is off until a player switches it on in **Settings → Online**
(push to talk on `Z` by default, or always on). Players near you are heard
from where they are: full volume within 40 m, fading to silence at 800 m, up
to the 16 nearest at once. Only players on the same world hear each other —
except a **party**, whose members hear each other wherever they are, on any
world: from where they stand when they are near, like a radio when they are
not (*Party voice* in Settings → Online). Party members are never the ones
dropped to make room for a stranger.

**How it works.** The sound goes straight from browser to browser (WebRTC).
The server only introduces them: it passes their connection details between
two players on the same world within about 1.5 km of each other, or between
two members of the same party anywhere. So voice
costs your server almost no bandwidth however much people talk.

**The microphone needs a secure page** — `https://…`, or `http://localhost` on
the server's own machine. On a plain `http://` address players can listen but
not talk (the game says *mic needs https*). Any tunnel, Caddy, Render or Fly
fixes that.

### When people cannot hear each other: TURN

To connect two browsers directly, each needs to discover how the outside world
reaches it. By default the server hands out Google's public **STUN** servers
for that, which works for most home connections. Some networks — strict
corporate or school firewalls, some mobile networks, "symmetric" NATs — cannot
be connected directly at all; the two players see each other but hear nothing.
For those, voice has to be **relayed** through a **TURN** server.

A TURN server needs a machine with a public address and UDP ports open, so
tunnels and Render are no use for it; a small VPS is ideal (the same one as
the game is fine). Or use a hosted TURN service.

**coturn on Ubuntu:**

```sh
sudo apt install -y coturn
```

`/etc/turnserver.conf`:

```ini
listening-port=3478
fingerprint
lt-cred-mech
user=terraglide:CHOOSE-A-LONG-RANDOM-PASSWORD
realm=play.example.com
# The ports relayed audio uses. Keep the range small and open it in the firewall.
min-port=49160
max-port=49200
# Only on a cloud machine whose public address is not on its own network card
# (AWS, Google Cloud, Oracle): external-ip=PUBLIC.IP/PRIVATE.IP
# A ceiling on relayed connections at once, because everyone signed in to
# the game is given this password. (No user-quota: every player shares the
# one username, so a per-user quota would be a ceiling for all of them
# together.) Each pair of players talking through the relay uses a few.
total-quota=200
stale-nonce=600
no-multicast-peers
no-cli
# Never relay into private networks.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

```sh
# On older Ubuntu releases, also uncomment TURNSERVER_ENABLED=1 in /etc/default/coturn
sudo systemctl restart coturn
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
```

**Tell the game server about it**, with environment variables:

```sh
TURN_URL="turn:turn.example.com:3478,turn:turn.example.com:3478?transport=tcp" \
TURN_USERNAME=terraglide \
TURN_CREDENTIAL=CHOOSE-A-LONG-RANDOM-PASSWORD \
node server/server.mjs
```

or in `config.json` (keep the default STUN entry first):

```json
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    {
      "urls": ["turn:turn.example.com:3478", "turn:turn.example.com:3478?transport=tcp"],
      "username": "terraglide",
      "credential": "CHOOSE-A-LONG-RANDOM-PASSWORD"
    }
  ]
}
```

Players pick the change up the next time they sign in.

**Check it works** with WebRTC's own test page,
<https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>: add
your TURN address, username and password, press *Gather candidates*, and look
for a line of type `relay`. No `relay` means the TURN server is not reachable
(ports, firewall, password).

**Hosted TURN** works the same way: any service that gives you a TURN address,
a username and a password goes in `TURN_URL`, `TURN_USERNAME` and
`TURN_CREDENTIAL`. Credentials that expire after a few hours have to be
replaced when they do.

Every signed-in player's browser receives the TURN password — that is how
WebRTC works — so anyone on your server could use your relay for other things.
The quota and `denied-peer-ip` lines above limit what that can cost you.

---

## Worlds

A server holds every world at once: Earth, the Moon, Mars, Mercury, Venus,
Ceres, Vesta, Io, Europa, Ganymede, Callisto, Titan, Enceladus, Pluto and
Charon. Players move between them with `/travel moon` (or the world picker,
`U`) — the world's id or its name, so `/travel the moon` and `/travel luna`
work too, and `/travel home` comes back to Earth. Travelling has a 10-second
cooldown and is not allowed mid-fight or while dead; the page reloads into
the new world and signs straight back in.

**Each world is separate.** For every player, every world keeps its own
position, explored ground, trail, waypoints and lander, so going to Mars and
coming back puts you back where you left Earth. Each world has its own spawn,
which an admin can move with `/setspawn`. Players only see — and only fight
and hear — others on the same world; the players list and `/list` show who is
where. Text chat is shared across all worlds, except `/near`.

---

## Updating

**From git** (your computer or a VPS):

```sh
git pull
node tools/bundle.mjs        # rebuild the game bundle — git pull does not
```

then restart the server (`Ctrl+C` and start it again, or
`sudo systemctl restart terraglide`; on a VPS run both commands with
`sudo -u terraglide` in `/srv/terraglide/app`). **Do not skip the bundle**:
the server only builds it when it is missing, so after a pull it would keep
serving the old game to a new server. (Deleting `terraglide.bundle.js` and
restarting does the same.)

**From a ZIP:** download the new ZIP, unzip it, and copy your old
`server/data/` folder (and `server/config.json`, if you made one) into it.

**Docker:**

```sh
git pull
docker build -t terraglide .
docker stop terraglide && docker rm terraglide
docker run -d --name terraglide --restart unless-stopped -p 8080:8080 -v terraglide-data:/data terraglide
```

(`docker stop` first, not `docker rm -f`, which kills it without saving.)

**Render:** push to the repository it deploys from; it redeploys on its own.
**Fly.io:** `git pull`, then `fly deploy`.

The data folder is never part of an update — accounts and players carry
straight over. Keep the server up to date: the published game always runs the
newest version, and if the server is older the page may say *"This server
runs a different version of the game — reload the page"*. Players can always
use the server's own page, which matches it.

---

## Troubleshooting

| What you see | What is wrong, and the fix |
| --- | --- |
| *"Could not reach HOST — is the server running, and is the address right?"* | The server is not running, the address or port is wrong, or something is in the way. Open `http://HOST:PORT/api/status` (or `https://HOST/api/status`) in a browser: JSON means the server is reachable and the address in the game is wrong; nothing means it is not reachable — check the firewall, that you are on the same network, and that the network does not isolate devices. |
| *"This page is https, so it can only reach wss:// servers"* | Mixed content: the published game (https) cannot use a `ws://` server. Give the server an https address ([tunnel](#over-the-internet-with-a-tunnel-easiest), [Caddy](#your-own-domain-with-caddy)) and use `wss://`, or open the server's own page (`http://HOST:8080`) instead. |
| Friends on the same wifi cannot connect | The firewall (Windows: allow Node.js on *Private* networks, and make sure the network is set to Private), a guest network that isolates devices, or the wrong address. Try from your own phone on the same wifi. Use a tunnel if the network will not cooperate. |
| *"Could not listen on 0.0.0.0:8080: listen EADDRINUSE…"* | Something else is using the port — often another copy of the server, or `npm start`. Stop it, or use another port (`PORT=8081`). To find it: `netstat -ano | findstr :8080` on Windows, `lsof -i :8080` on macOS/Linux. |
| Render: first visit takes a minute | The free plan was asleep; it wakes on the first visit. |
| Render: every account has vanished | The free plan wipes its disk whenever it sleeps or redeploys. Use a paid plan with a disk — see [Render](#render). |
| *"Too many new accounts from here — try again in N s"* for everybody | The server is behind a tunnel or proxy without `trustProxy`, so everyone shares one address. Turn `trustProxy` on. |
| The same, for a group in one place — a class, a club, a household | They share one public address, and so the `signupsPerHour` allowance. Raise it for the day — see [Rate limits](#rate-limits). |
| *"Too many tries — wait N s"* for people who typed their password right | Eight sign-in attempts failed from their address within five minutes — on a shared address, other people's typos count too. Wait it out (at most five minutes). |
| Everyone was banned at once | Same cause; see [Bans](#bans). |
| Voice: *"mic needs https"* | The page is on plain `http://`. Use an https address. |
| Voice: two players near each other hear nothing | Both must have voice on (Settings → Online) and be within 800 m on the same world, and neither muted the other in the players list. If all that is true, their networks cannot connect directly: add a [TURN server](#when-people-cannot-hear-each-other-turn). |
| Voice: people hear themselves | Someone is on speakers. Headphones fix it. |
| Forgot the admin password | [Reset it](#resetting-a-password), or make another account an admin with `--admin`. |
| A password reset or `--admin` "did nothing" | It was run while the server was running, which wrote over it. Stop the server first — see the note under [Admins](#admins). |
| The log says `[store] accounts.json could not be read (…); kept as …accounts.json.broken-1759…` | The file was damaged (a full disk, a hand edit with a typo). The server kept it, renamed, and started **without it** — so for now there are no accounts, and with `firstAccountIsAdmin` on the next person to sign up becomes an admin. Stop the server at once, then fix the JSON in the `.broken-…` file (or take `accounts.json` from a backup), rename it back to `accounts.json`, and start again. The same goes for `server.json` (bans, spawns) and `players/<name>.json` (one player's record). |
| *"server/config.json is not valid JSON: …"* | A typo in the config file — usually a trailing comma or a comment. Fix it; the message says where. |
| `EACCES: permission denied, mkdir '/data/players'` (Docker) | The container was started with `--user`, so it did not take ownership of `/data`, and that user cannot write there — or the mount refuses ownership changes (some network drives). Start it without `--user`, `sudo chown` the folder to that user, or use a named volume. |
| Players are disconnected with *"Moving impossibly fast"* on a bad connection | Very rare with honest play. If it keeps happening, raise `maxSpeed` a little (220). |
| *"Signed in from somewhere else"* | The same account was opened in another tab or device; the newest wins. |
| *"This server runs a different version of the game"* | The page and the server are from different versions. [Update](#updating) the server, or play on the server's own page. |
| After updating, the game looks unchanged | The bundle was not rebuilt: `node tools/bundle.mjs`, then reload the page. |

---

## Publishing and credit

TerraGlide is not open source; it is published under the licence in
[`LICENSE`](LICENSE). Running a server for yourself is private use. **Running
a server that other people play on counts as publishing the game** — the
server hands every visitor the game page — and so does putting the game on a
website. Publishing is allowed, on the licence's conditions, in short:

- The credit **"TerraGlide by Eabusham2"**, word for word, must be clearly
  visible wherever the game is published — on the page carrying it, in its
  description, or in the game's own interface, not hidden in a menu nobody
  opens. An easy way for a server: put it in the server's `motd` (shown on the
  sign-in form and in the welcome line, as in the examples above), and in
  whatever post or page you share the link from.
- If money is involved in any way — ads, sponsorship, donations tied to it —
  also show a working, clickable link to <https://github.com/Eabusham2/terraglide>
  in the same place as the credit. (The `motd` is plain text, so put the link
  on the page or post you share the server from.)
- Keep the licence and every notice and attribution where they are (the server
  already serves `LICENSE` and `THIRD-PARTY.md`), do not present the game as
  your own, and do not charge for access to it — that needs written permission.
- **Map data is not part of the game.** Each player's browser fetches imagery
  and elevation straight from the map providers; your server never touches
  them, needs no map keys and carries no map traffic. Those providers' own
  terms still apply to a published game (licence section 4), and the
  attribution lines the game shows for them must stay visible.

`LICENSE` is the authoritative text; read section 2(e) before publishing, and
ask (an issue on the repository will do) about anything it does not cover.

---

## Checking it works

Quick checks against any server:

```sh
curl http://localhost:8080/healthz          # ok
curl http://localhost:8080/api/status       # {"terraglide":true,"name":…,"online":…}
```

The repository's own tests (for people changing the server):

```sh
node tools/servertest.mjs     # the real server on a spare port with a throwaway
                              # data folder, driven over real WebSockets: sign-up,
                              # chat, teleport requests and their timeout, a sword
                              # fight, refused moves, saving to disk
node tools/onlinecheck.mjs    # two real browsers through the actual sign-up form
                              # (needs Playwright and Chromium; about a minute)
node tools/flightcheck.mjs    # every world flown with the game's own flight
                              # model - climbs, dives, rocket pumping, surges,
                              # landings, network stalls - and nothing honest
                              # may be put back by the speed checks
```
