# Putting it in front of people

The point of this file is one thing: get a URL you can paste to strangers today.
Everything else about the game is guesswork until people who are not you have
played it.

Share the URL and the game does the rest — whoever opens it lands in a public
town, and the four-letter code in the lobby (or the `#CODE` in the address bar)
is the invite for a private one.

## Locally, right now

```
npm install && npm start          # http://localhost:8080
```

Anyone on the same network can reach `http://<your-lan-ip>:8080`. That is enough
for a first playtest with people in the same room or on the same VPN.

## Docker

```
docker build -t highnoonhollow .
docker run -p 8080:8080 highnoonhollow
```

The image is Node 22 Alpine with production dependencies only. `PORT` is
respected, so most hosts need no configuration at all.

Telemetry appends to `/app/data`, which the image creates and owns and declares
as a volume. Mount something there if you want the playtest log to survive a
restart:

```
docker run -p 8080:8080 -v hnh-data:/app/data highnoonhollow
```

Without a mount it still works, it just starts empty each deploy. Set
`HNH_TELEMETRY=0` to turn the whole thing off, or `HNH_TELEMETRY_DIR` to write
somewhere else.

`GET /healthz` returns live state and is wired to the container healthcheck:

```json
{
  "ok": true, "uptime": 412,
  "rooms": 3, "inMatch": 1, "humans": 7, "capacity": 100,
  "tickMs": 1.16, "peakTickMs": 4.8, "tickBudgetMs": 50, "overruns": 0
}
```

The last four are the ones to watch. `tickMs` is a smoothed average of what one
pass over every room costs; `tickBudgetMs` is what it has to spend. A game
server that has run out of core does not fail — every room on it goes slow at
once, and the only way anybody finds out is that the game *feels* wrong. If
`overruns` is climbing, the process is past what it can serve; the log says so
too, once every hundred rather than every tick.

## Hosting it

Any host that runs a container and passes WebSockets through will work. Two
things matter: **WebSocket support** and **a single instance** (see the caveat
below).

**Fly.io** — `fly.toml` is included; `fly launch --no-deploy` then `fly deploy`.
Keep `min_machines_running = 1` so the first visitor does not wait for a cold
start; an empty lobby that takes ten seconds to answer is an empty lobby.

**Render / Railway / Koyeb** — point them at this repo, they detect the
Dockerfile, set nothing. Disable scale-to-zero for the same reason.

**A plain VPS** — run the container behind a TLS proxy. Caddy needs three lines
and handles both the certificate and the WebSocket upgrade:

```
hollow.example.com {
    reverse_proxy localhost:8080
}
```

For nginx, remember the upgrade headers — without them the game connects, hangs,
and looks broken:

```nginx
location / {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

The client picks `ws://` or `wss://` from the page's own protocol, so serving the
page over HTTPS is all that is needed for a secure socket.

## Can I just put it on Vercel?

Not the game server, no — and it is worth understanding why before you spend an
afternoon on it.

Vercel runs **serverless functions**: short-lived, stateless, spun up per request
and torn down. This game needs the opposite of all three:

| The game needs | Serverless gives |
|---|---|
| A process that lives for the whole match | A function that ends with the request |
| A 20 Hz tick loop running continuously | No background execution between requests |
| Rooms held in memory across minutes | No shared memory between invocations |
| Persistent WebSocket connections | Request/response, no long-lived sockets |

You could host the *client* on Vercel and point it at a game server somewhere
else, but then you are running two deployments to serve one game, and the static
files are the easy half anyway. The Node server already serves them.

**What to use instead.** The hosts in the section above are the same "connect a
repo, press deploy" experience as Vercel, but they run a persistent container:

- **Fly.io** — `fly.toml` is already in this repo
- **Railway** — detects the Dockerfile, no config
- **Render** — same, pick "Web Service"

All three keep a process alive and pass WebSockets through, which is the entire
requirement. It is still a web game either way: players click a link and play in
the browser. Only the hosting changes.

The same reasoning rules out Netlify, Cloudflare Pages, and GitHub Pages. If you
ever *must* be on one of those, the game would have to move its realtime layer to
a managed service (Cloudflare Durable Objects, Ably, PartyKit and similar), which
is a real rewrite of `server/rooms.js` and `server/room.js` — not a config change.

## The one caveat that will bite you

**Rooms live in memory in a single process.** Two instances behind a load
balancer means two separate sets of towns, and a code created on one is
"not found" on the other. Until there is a shared room registry, run exactly
one instance.

That is fine further than you would think — a room is a handful of objects and
a 20 Hz tick, and one small VM holds many concurrent matches. Watch `tickMs`
against `tickBudgetMs` on `/healthz` rather than watching `rooms`.

## Sizing

Measured, not guessed. A full eight-player room costs about **0.39 ms a tick**
in the free-for-all and **0.26 ms** at the table, on one core of the machine
this was written on, with every seat filled by a bot — which is the expensive
case, because bot AI is most of that number and a room of humans is cheaper.
The loop runs at 20 Hz, so it has **50 ms** a tick to spend across every room on
the process. That works out at roughly **130 full free-for-all rooms** on one
core before the budget is gone.

`HNH_MAX_ROOMS` defaults to **100**, which leaves headroom on purpose: a shared
vCPU is slower than the box those numbers came from, and past the budget nothing
fails loudly — every room just starts running slow at once. Raise it if you have
measured your own, and watch `tickMs` when you do.

- Memory is dominated by the map geometry, which is shared, plus a few hundred
  bytes per player per room.
- Bandwidth is roughly a 20 Hz snapshot per player, a few KB/s each.

A 1 vCPU / 512 MB instance is a sensible place to start a playtest.

## Going down

`SIGTERM` — which is what every deploy platform sends — closes every socket with
**1012, service restart**, flushes the playtest log, and exits. That code matters:
the client knows it and waits about ninety seconds for the server to come back,
saying "server restarting", instead of treating a rolling deploy as a broken
network and giving up after twenty. Nothing needs configuring for this; it is
worth knowing because a deploy that drops eight people in silence looks exactly
like an outage.

## Closing the readout

`GET /stats` is aggregate only — no names, no room codes, nothing about one
person — so it is open by default, which is what a playtest wants. Set
`HNH_STATS_TOKEN` on a public deployment and it wants `?token=` to match, and
404s anything else.

## Before you charge money for it

Positions are now culled server-side, so a modified client cannot see through
walls. What remains is that **movement is client-simulated and only
speed-clamped** — a modified client can still move faster or more precisely than
it should.

That does not matter when you are playing with friends to find out whether the
game is fun. It matters the moment strangers are competing for anything.

While you are playtesting, `GET /stats` is worth more than your memory of it:

```
curl -s https://your-host/stats | jq '.witnessedKillShare, .cardPlayRate, .wins'
```

`witnessedKillShare` is the headline: if almost every kill is witnessed the map
has no secrets, and if almost none are, nobody can ever learn anything.
`cardPlayRate` is the deck's: below about half and it is decoration.
