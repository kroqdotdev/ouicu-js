import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "../src/index";
import { runSetup, USAGE } from "../src/setup";

const [command, ...rest] = process.argv.slice(2);

if (command === "setup") {
  runSetup(rest).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
} else if (command === "--help" || command === "-h") {
  console.log(`@ouicu/mcp ${VERSION}: ouicu's tools for coding agents, over MCP.

  npx -y @ouicu/mcp                 the server, on stdin and stdout
  npx -y @ouicu/mcp setup <tool>    add it to a coding tool

${USAGE}

The server uses the key \`ouicu login\` saved, or OUICU_API_KEY. Sharing a
port needs the ouicu CLI: curl -fsSL https://ouicu.com/install.sh | sh, or in
PowerShell on Windows: irm https://ouicu.com/install.ps1 | iex`);
} else if (command === "--version" || command === "-V") {
  console.log(VERSION);
} else if (command && command !== "--") {
  console.error(`There is no command "${command}". Try --help.`);
  process.exit(1);
} else {
  const server = createServer();
  let closing = false;
  // The client went away, or the process is told to stop: shares this
  // server started stop with it (the SDK stops their CLIs on exit).
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.connect(new StdioServerTransport()).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
