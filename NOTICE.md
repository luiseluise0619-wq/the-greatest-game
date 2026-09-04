# Third-party notices

This game ships two runtime dependencies and no art assets. Everything you see
and hear — every card face, every character, every sound — is generated at
runtime by code in this repository, so there is nothing else here whose licence
has to travel with it.

Both dependencies are MIT. `three` is the one that matters for redistribution:
it is served to the browser straight out of `node_modules` (there is no build
step), so anybody who deploys this is distributing it, and the MIT licence asks
that its copyright notice go along. Both are reproduced in full below.

The licence of this project's own code is not set here — that is the
repository owner's call, and a file that guessed at it would be worse than an
absent one.

---

## three (v0.160.1) — MIT

The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---

## ws (v8.21.3) — MIT

Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
Copyright (c) 2013 Arnout Kazemier and contributors
Copyright (c) 2016 Luigi Pinca and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Development-only

`playwright` is used by `npm run test:browser` and is not declared in
`package.json`, is not installed by `npm ci --omit=dev`, and is not present in
the container the Dockerfile builds. Nothing it brings with it is distributed.

## Assets that are deliberately not here

`client/models/` can hold a glTF character to swap in for the built-in
geometry, and the one used while that path was being developed is CC-BY-4.0 —
not ours to ship. It is kept out of the repository by `.gitignore` and out of
any package by the exclude list in the packaging step. If you drop a model in
there yourself, its licence is yours to honour.
