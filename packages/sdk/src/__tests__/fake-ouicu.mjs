#!/usr/bin/env node
/*
 * A stand-in for the ouicu CLI in tests. It answers --version and plays
 * `share <port> --json` as FAKE_OUICU_PLAY says, printing the events the
 * real one prints (apps/cli/src/events.rs). FAKE_OUICU_VERSION is the
 * version it says it is (0.1.8). FAKE_OUICU_RECORD names a file to write
 * its arguments and environment to.
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const version = process.env.FAKE_OUICU_VERSION ?? "0.1.8";
if (args[0] === "--version") {
  console.log(`ouicu ${version}`);
  process.exit(0);
}
if (process.env.FAKE_OUICU_RECORD) {
  const env = {};
  for (const k of [
    "OUICU_API_KEY",
    "OUICU_API",
    "OUICU_TUNNEL",
    "OUICU_PASSWORD",
  ])
    if (process.env[k] !== undefined) env[k] = process.env[k];
  writeFileSync(
    process.env.FAKE_OUICU_RECORD,
    JSON.stringify({ args, env, pid: process.pid }),
  );
}

const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const end = (code) => process.stdout.write("", () => process.exit(code));
const at = args.indexOf("--name");
const name = at >= 0 ? args[at + 1] : "quiet-otter";
const allow = args.some((a) => a === "--allow" || a.startsWith("--allow="));
if (allow && args.includes("--password")) {
  // As clap refuses it.
  process.stderr.write(
    "error: the argument '--password' cannot be used with '--allow <EMAILS>'\n",
  );
  process.exit(2);
}
const live = {
  event: "live",
  url: `https://${name}.ouicu.app`,
  name,
  expiresAt: "2026-10-03T12:00:00.000Z",
  // Pro has no notice.
  notice: !allow,
  password: args.includes("--password"),
};
// 0.1.8 added the list of people, and says whether there is one.
if (version.localeCompare("0.1.8", undefined, { numeric: true }) >= 0)
  live.people = allow;
const untilStopped = () => {
  process.on("SIGINT", () => {
    say({ event: "stopped", reason: "you stopped it on this computer" });
    end(0);
  });
  setInterval(() => {}, 1000);
};

switch (process.env.FAKE_OUICU_PLAY ?? "live") {
  case "refused":
    say({ event: "error", message: "That name is taken." });
    end(1);
    break;
  case "crash":
    process.stderr.write("thread 'main' panicked at src/main.rs\n");
    process.exit(101);
    break;
  case "never":
    say({
      event: "retrying",
      message: "Could not reach the tunnel.",
      seconds: 1,
    });
    untilStopped();
    break;
  case "stopped-on-ouicu":
    say(live);
    setTimeout(() => {
      say({ event: "stopped", reason: "you stopped it on ouicu.com" });
      end(0);
    }, 50);
    break;
  case "ignores-sigint":
    say(live);
    process.on("SIGINT", () => {});
    setInterval(() => {}, 1000);
    break;
  default:
    process.stdout.write("not an event, which is passed over\n");
    say(live);
    setTimeout(() => {
      say({
        event: "notice",
        text: "Kept back /movie.mp4: not part of a web page.",
      });
      say({
        event: "request",
        method: "GET",
        path: "/pricing",
        status: 200,
        ms: 12,
      });
      say({
        event: "retrying",
        message: "The connection dropped.",
        seconds: 1,
      });
      say({ event: "reconnected" });
    }, 20);
    untilStopped();
}
