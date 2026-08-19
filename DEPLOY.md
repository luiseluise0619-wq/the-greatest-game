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

`GET /healthz` returns live state and is wired to the container healthcheck:

```json
{ "ok": true, "uptime": 412, "rooms": 3, "inMatch": 1, "humans": 7 }
```

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

## The one caveat that will bite you

**Rooms live in memory in a single process.** Two instances behind a load
balancer means two separate sets of towns, and a code created on one is
"not found" on the other. Until there is a shared room registry, run exactly
one instance.

That is fine further than you would think — a room is a handful of objects and
a 20 Hz tick, and one small VM holds many concurrent matches. Watch `/healthz`;
worry about scaling when `rooms` is regularly in the dozens.

## Sizing

Rough, from how the server is built rather than from measurement — treat as a
starting point and check `/healthz` under real load:

- Memory is dominated by the map geometry, which is shared, plus a few hundred
  bytes per player per room.
- CPU is one 20 Hz tick across all rooms; bot AI is the expensive part, so a
  room full of bots costs more than a room full of humans.
- Bandwidth is roughly a 20 Hz snapshot per player, a few KB/s each.

A 1 vCPU / 512 MB instance is a sensible place to start a playtest.

## Before you charge money for it

Two things in the current build are fine for a friendly playtest and not fine
for a paid product, both noted in the main README:

- movement is client-simulated and only speed-clamped,
- every player's position is broadcast to every client, so a modified client
  can see through walls.

Neither matters when you are playing with friends to find out whether the game
is fun. Both matter the moment strangers are competing.
