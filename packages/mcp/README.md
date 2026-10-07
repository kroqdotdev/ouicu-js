# @ouicu/mcp

An MCP server for [ouicu](https://ouicu.com). A coding agent can share the
dev server it is working on, or put a built site up, and hand back a link
to send to someone: "build the landing page and send me a link" in one
turn.

## Set up

```sh
npx -y @ouicu/mcp setup claude-code
```

or `claude-desktop`, `cursor`, `vscode`, `codex`, `windsurf`. If this
computer is not logged in to ouicu, it logs you in first: it shows a code,
opens ouicu.com in your browser to approve it, and saves the key where the
`ouicu` CLI keeps it. Then it adds the server to the tool, for every
project. The key never goes into the tool's settings; the server reads it
from the credentials file, so `ouicu login` and the server share one login.

When the tool's own command (`claude`, `codex`) is missing, it prints the
command to run by hand. For Claude Code that is:

```sh
claude mcp add -s user --transport stdio ouicu -- npx -y @ouicu/mcp
```

Any other MCP client starts it as `npx -y @ouicu/mcp` (stdio):

```json
{
  "mcpServers": {
    "ouicu": { "command": "npx", "args": ["-y", "@ouicu/mcp"] }
  }
}
```

Sharing a port also needs the ouicu CLI, 0.1.7 or later (0.1.8 to share
with only invited people):

```sh
curl -fsSL https://ouicu.com/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://ouicu.com/install.ps1 | iex
```

## Tools

| Tool                    | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `ouicu_share_port`      | Shares a port at a public link while the server runs (port, name?, password?, allow?) |
| `ouicu_stop_share`      | Stops a share by name, id or link, here or anywhere on the account                    |
| `ouicu_list_shares`     | Live shares first, then the latest ended                                              |
| `ouicu_deploy`          | Puts a built folder up at a link that lasts (directory, name?, spa?, password?)       |
| `ouicu_list_sites`      | The account's sites                                                                   |
| `ouicu_delete_site`     | Deletes a site and its files                                                          |
| `ouicu_recent_requests` | The latest requests to a share or site: who opened it, and what failed                |
| `ouicu_usage`           | The month's data against the plan's allowance                                         |
| `ouicu_whoami`          | The account and plan                                                                  |

Each answers in words an agent can pass on, with the same as structured
content. Links are public: anyone who has one can open it unless it has a
password or is only for invited people. On the Free plan, people opening a
link in a browser first see a short notice from ouicu saying who shared it.

Shares the server starts run inside it, through the CLI, and stop when it
stops or with `ouicu_stop_share`. For a link that outlives the session,
use `ouicu_deploy`.

### Only invited people

On Pro, `ouicu_share_port` takes `allow`: email addresses, or `@` and a
domain (`@client.com`) for everyone at one. Only those people can open the
link. ouicu does not send it to them; you do, as with any link. On opening
it, each types their email address on ouicu's page and, if it is on the
list, gets a sign-in link by email. Your own address always gets in.
`allow` does not go with `password`. The tool says when only invited
people can open a share, and `ouicu_list_shares` and `ouicu_list_sites`
say "only invited people can open it" for those.

Asking again for a port the server already shares hands back that share
only when the same people can open it (anyone, the same password or the
same list); otherwise the tool says to stop it first.

### Without a key

The server starts with one tool, `ouicu_login`. It opens the approval page
in the person's browser when it can (otherwise it answers with the code
and the address for the agent to pass on) and waits for the approval. The
other tools then appear without a restart. When the saved key stops
working, `ouicu_login` comes back.

## Settings

The server reads `OUICU_API_KEY` (a key from ouicu.com, instead of the
saved login), `OUICU_API` (another ouicu than ouicu.com), `OUICU_TUNNEL`
and `OUICU_BIN` (the CLI to run). From code:

```ts
import { createServer } from "@ouicu/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

await createServer().connect(new StdioServerTransport());
```

## License

MIT
