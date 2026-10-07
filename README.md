# ouicu for JavaScript: SDK and MCP server

[ouicu](https://ouicu.com) gives the site running on your computer a public
https link, like `https://studiolund.ouicu.app`, so a client or teammate can
open it on any phone or computer. This repository holds ouicu's two npm
packages:

| Package                                                  | What it does                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`@ouicu/mcp`](https://www.npmjs.com/package/@ouicu/mcp) | An MCP server: Claude Code, Cursor, Codex and other coding agents share your dev server or upload a build and hand you the link. |
| [`@ouicu/sdk`](https://www.npmjs.com/package/@ouicu/sdk) | ouicu from Node: share a port, upload a built site, list shares and sites, see who opened them.                                  |

## MCP server

```sh
npx -y @ouicu/mcp setup claude-code
```

The same works for `cursor`, `codex`, `vscode`, `windsurf` and
`claude-desktop`. Then ask your agent for a link in your own words, for
example "build the gallery page and send me a ouicu link". The agent shares
the dev server, or uploads the build, and hands back the address.

It is listed in the official MCP Registry as `com.ouicu/mcp`. Docs:
[ouicu.com/docs/mcp](https://ouicu.com/docs/mcp). More in
[packages/mcp](packages/mcp).

## SDK

```sh
npm install @ouicu/sdk
```

```ts
import { Ouicu } from "@ouicu/sdk";

const ouicu = new Ouicu({ apiKey: process.env.OUICU_API_KEY });
const share = await ouicu.share({ port: 3000, name: "studiolund" });
console.log(share.url); // https://studiolund.ouicu.app
```

Node 20 or later, no other dependencies. Docs:
[ouicu.com/docs/sdk](https://ouicu.com/docs/sdk). More in
[packages/sdk](packages/sdk).

## What ouicu is for

Showing work in progress to people who aren't developers: a reserved name
keeps the same link for each client, a password or a list of invited
people keeps it private, you get an email when someone opens it, and the
last version stays up while your laptop sleeps. It passes web pages
(HTTP and WebSockets), not TCP, video or downloads. Plans and limits:
[ouicu.com/docs/plans](https://ouicu.com/docs/plans).

The `ouicu` command line tool itself is installed from
[ouicu.com](https://ouicu.com/docs/getting-started); its releases are at
[kroqdotdev/ouicu-cli](https://github.com/kroqdotdev/ouicu-cli).

## About this repository

These packages are developed in ouicu's main repository and copied here
on every change, so this history is a series of snapshots. Issues are
welcome here; for a change, open an issue or a pull request and it will be
made upstream. Questions: hello@ouicu.com.

```sh
pnpm install
pnpm build
pnpm test
```

MIT licensed. See [LICENSE](LICENSE).
