# @ouicu/sdk

[ouicu](https://ouicu.com) from Node: share a port on your computer at a
public link, put a built site up, and see your shares, your sites, who
opened them and the month's data.

```sh
npm install @ouicu/sdk
```

Node 20 or later. No other dependencies.

## Logging in

The SDK uses the same key as the `ouicu` CLI. In order, it takes:

1. the `apiKey` option,
2. `OUICU_API_KEY`,
3. the key `ouicu login` saved (`~/.config/ouicu/credentials.json` on
   Linux, `~/Library/Application Support/ouicu/credentials.json` on a Mac).

Make a key under Account on ouicu.com for CI. To log in from a script the
way `ouicu login` does:

```ts
import { Ouicu } from "@ouicu/sdk";

const ouicu = new Ouicu();
await ouicu.login({
  onCode: ({ userCode, verificationUrl }) =>
    console.log(`Approve ${userCode} at ${verificationUrl}`),
});
```

The key is saved where the CLI keeps it, so the CLI is logged in too.

## Put a built site up

```ts
const site = await ouicu.deploy("./dist", {
  name: "studio", // one of your sites to replace, or a reserved name
  spa: true, // unknown paths get index.html
  onProgress: ({ sent, total }) => console.log(`${sent} of ${total}`),
});
console.log(site.url); // https://studio.ouicu.app
```

It works as `ouicu deploy` does: only files ouicu does not have yet are
uploaded, six at a time. Dot files (but `.well-known`), `node_modules` and
links are left out, and so is anything that is not part of a web page;
`site.skipped` says what and why. Free sites go a week after their last
upload (`site.expiresAt`).

## Share a port

```ts
const live = await ouicu.share(3000, {
  onRequest: ({ method, path, status }) => console.log(method, path, status),
});
console.log(live.url); // https://quiet-otter.ouicu.app

// later
await live.stop();
```

This runs the ouicu CLI (`ouicu share 3000 --json`), which has to be
installed, version 0.1.7 or later (0.1.8 for `allow`):

```sh
curl -fsSL https://ouicu.com/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://ouicu.com/install.ps1 | iex
```

`share()` resolves once the link works and rejects with the CLI's words if
it is refused (a name taken, a plan limit). `live.closed` settles when the
share ends, however it ends, with the reason. Shares still running when
your process exits are stopped. On the Free plan, people opening the link
in a browser see a short notice from ouicu first (`live.notice`).

A password (Hobby and Pro) goes to the CLI through its environment, never
its arguments: `ouicu.share(3000, { password: "..." })`.

### Only invited people

On Pro, `allow` lets only the people you name open the link: email
addresses, or `@` and a domain for everyone at one.

```ts
const live = await ouicu.share(3000, {
  allow: ["anna@acme.com", "@client.com"],
});
live.people; // true
```

A visitor types their email address on ouicu's page and, if it is on the
list, gets a sign-in link by email. Your own address always gets in.
`allow` does not go with `password`, and needs the CLI 0.1.8 or later;
`share()` says so before it runs anything. A reserved name can keep a
list of its own (the Shares page on ouicu.com), and `live.people` is true
then too. `shares.list()` and `sites.list()` say the same with `people`.

## Shares, sites and the month's data

```ts
await ouicu.whoami(); // { email, name, plan, key }
await ouicu.usage(); // { plan, month, bytes, requests, allowanceBytes, resetsAt, over }

await ouicu.shares.list(); // live ones first, then the latest ended
await ouicu.shares.stop(id);
await ouicu.shares.requests(id); // { available, visitors, requests }

await ouicu.sites.list();
await ouicu.sites.delete(id);
await ouicu.sites.requests(id);
```

## Errors

Everything ouicu refuses throws an `OuicuError` with ouicu's own words
and the HTTP `status`: 401 a key that does not work (or none), 403 not on
your plan or a suspended account, 404, 409 a name taken, 413 too large,
429 too many or over the month's data. `status` is 0 when ouicu never
answered, a folder could not be read, or the CLI failed.

```ts
import { OuicuError } from "@ouicu/sdk";

try {
  await ouicu.deploy("./dist");
} catch (err) {
  if (err instanceof OuicuError && err.status === 429) console.log(err.message);
  else throw err;
}
```

## Settings

| Option   | Environment     | Default                     |
| -------- | --------------- | --------------------------- |
| `apiKey` | `OUICU_API_KEY` | the key `ouicu login` saved |
| `api`    | `OUICU_API`     | `https://ouicu.com`         |
| `tunnel` | `OUICU_TUNNEL`  | the CLI's own               |
| `bin`    | `OUICU_BIN`     | `ouicu` on the PATH         |

## License

MIT
