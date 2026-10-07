import type { RecentRequest, Share, Site } from "@ouicu/sdk";

/** "512 B", "1.2 MB", "34 GB". */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "2026-10-03 10:02 UTC". */
export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "1 request", "12 requests". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Whether `ref` (a name, an id or a link) means this share or site. */
export function refersTo(
  ref: string,
  thing: { id?: string; name: string; url: string },
): boolean {
  const clean = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  const r = clean(ref);
  return (
    r === clean(thing.name) ||
    r === clean(thing.url) ||
    (thing.id !== undefined && r === thing.id.toLowerCase())
  );
}

export function shareLine(s: Share & { startedHere?: boolean }): string {
  const parts = [
    s.live
      ? `live at ${s.url} since ${when(s.startedAt)}`
      : `ended ${s.endedAt ? when(s.endedAt) : ""}${s.ended ? ` (${s.ended})` : ""}, was ${s.url}`,
    `from ${s.client}`,
    `${count(s.requests, "request")}, ${size(s.bytes)}`,
  ];
  if (s.password) parts.push("behind a password");
  if (s.people) parts.push("only invited people can open it");
  if (s.startedHere) parts.push("started by this MCP server");
  return `- ${s.name}: ${parts.join("; ")} (id ${s.id})`;
}

export function siteLine(s: Site): string {
  const parts = [
    s.url,
    `${count(s.files, "file")}, ${size(s.size)}`,
    `uploaded ${when(s.uploadedAt)}`,
    s.expiresAt ? `goes ${when(s.expiresAt)}` : "kept until deleted",
    `${count(s.requests, "request")}, ${size(s.bytes)} served`,
  ];
  if (s.password) parts.push("behind a password");
  if (s.people) parts.push("only invited people can open it");
  return `- ${s.name}: ${parts.join("; ")} (id ${s.id})`;
}

/**
 * A path as a visitor typed it, shown as data: control characters out,
 * cut at 120 characters, in quotes. It may say anything, instructions to
 * an agent included, so it is never more than a quoted string.
 */
export function visitorPath(path: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = path.replace(/[\u0000-\u001f\u007f]/g, "");
  return JSON.stringify(
    clean.length > 120 ? `${clean.slice(0, 120)}...` : clean,
  );
}

export function requestLine(r: RecentRequest): string {
  const where = [r.device, r.country].filter(Boolean).join(", ");
  const answer = r.ouicu ? `ouicu's ${r.ouicu} page` : `${r.status}`;
  return `${when(r.at).replace(" UTC", "")}  ${r.method} ${visitorPath(r.path)}  ${answer}  ${r.ms} ms  ${size(r.bytes)}  visitor ${r.visitor}${where ? ` (${where})` : ""}`;
}
