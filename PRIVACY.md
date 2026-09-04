# What this game knows about you

Short version: nothing that identifies you, and nothing that outlives the
server process unless the person running it turned the playtest log on.

This is written to be checkable rather than reassuring. Every claim below names
the file it is true in, so you can go and read it instead of taking it on trust.

## There are no accounts

There is no sign-up, no login, no email, no password and no profile. You type a
display name into a box or you do not, and it is whatever you typed — the server
trims it to 16 characters and never looks at it again except to print it
(`server/room.js`, `makePlayer`).

## What is stored while you are playing

A room is a JavaScript object in memory: who is in it, where they are standing,
what they are holding, and what has happened this round. It exists for as long
as the round does. An empty room is deleted 90 seconds later
(`server/rooms.js`, `IDLE_GRACE`), and everything in it goes with it.

Three things are kept in *your* browser, and nowhere else:

- A **session token** in `sessionStorage` under `hnh.token`, so that refreshing
  the page puts you back in the body you left standing rather than dealing you a
  new one. It is a random UUID, it means nothing anywhere else, and closing the
  tab discards it (`client/js/main.js`, `readToken`).
- The **display name you last typed**, in `localStorage` under `hnh_name`, so
  the box is filled in next time. Clear your site data and it is gone.
- Your **language and control settings**, in `localStorage` under
  `hnh.settings.v1` (`client/js/settings.js`).

None of the three is sent anywhere except the token, which goes back to the same
server that issued it, to identify a seat in a room that is about to disappear.

There is no database, and nothing is written to disk about a round — except:

## The playtest log

`server/telemetry.js` can append a line per event to `data/telemetry.jsonl`, and
`GET /stats` serves an aggregate summary of it. This exists so the person
running a playtest can find out whether the game is any good — how long rounds
last, what share of kills anybody witnessed, which cards nobody ever plays.

What it records is counts and durations. **Player names are off by default** and
only appear if whoever deployed it set `HNH_TELEMETRY_NAMES=1`
(`server/telemetry.js`, `WITH_NAMES`). It records no IP addresses, no browser
or device details, no location, and nothing that could connect two rounds to the
same person. `/stats` is aggregate only — no names and no room codes — whatever
that setting says.

`HNH_TELEMETRY=0` turns the whole thing off. On a deployment that wants the
readout closed to the public, `HNH_STATS_TOKEN` makes `/stats` want a token and
404 anything else.

## Chat

What you type in chat is relayed to the other people in your room and to nobody
else, and it is not written down anywhere. The server holds no history of it
past the moment it forwards it (`server/room.js`, `onChat`).

## Rooms are private because nobody guesses the code

A private room is reachable by its four-letter code and nothing else. It is not
listed anywhere. A socket that guesses twenty wrong codes is disconnected, so
finding one costs an attacker a new connection every twenty tries rather than a
tight loop (`server/index.js`).

## Third parties

None. No analytics, no ads, no fonts or scripts from anybody else's server. The
page loads its code and three.js from the same host it came from — the content
security policy of the deployment aside, there is nothing here that phones
anywhere (`client/index.html`, and the import map in it).

## Who to ask

Whoever deployed the instance you are playing on. This file describes what the
software does; it cannot describe what a particular host does around it — a
reverse proxy, a CDN or a platform in front of this will keep its own access
logs, and those are theirs and not covered here.
