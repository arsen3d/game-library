# Game library loader

The public part of a private game library: a page that finds the library's owner over WebRTC and runs the version the owner is
sharing from their computer. The games themselves are not in this repository or on this site.

- `public/live/`: the page that connects (`live/`), checks each version's signature against `live/key.js`, and installs it.
- `public/sw.js`: the service worker that serves the installed version.
- `public/vendor/`: [Trystero](https://github.com/dmotz/trystero), which introduces browsers to each other through public Nostr relays.
- `public/index.html`: a landing page for a visitor who has nothing installed yet.

A version is accepted only if it is signed with the owner's private key (its public half is in `public/live/key.js`) and is newer
than what the browser already has. Visitors' browsers connect to the owner's computer and to each other, so they can see each
other's IP addresses.

This repository is generated from the private library by `dev/publish-loader.mjs`; changes are made there.
