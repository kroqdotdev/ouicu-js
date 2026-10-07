import { spawn } from "node:child_process";

/**
 * Opens a web page in the person's browser, as well as it can tell:
 * true when the system's opener ran without complaint.
 */
export function openBrowser(url: string): Promise<boolean> {
  // Only a web page: the address comes from the server, so never a file
  // or another app's link.
  if (!/^https?:\/\//.test(url)) return Promise.resolve(false);
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // Not cmd's start, which reads & and | in the address.
          ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
      // An opener still running after a while has opened something.
      setTimeout(() => resolve(true), 3000).unref();
      child.unref();
    } catch {
      resolve(false);
    }
  });
}
