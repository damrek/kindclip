export function changelogSection(markdown: string, version: string | null): string | null {
  if (version === null) return null;
  const target = version.trim().replace(/^v/, "");
  if (target === "") return null;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const heading = `## [${target}]`;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return null;

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## [")) {
      break;
    }
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.startsWith("  ")) {
      const continuation = line.trimStart();
      const last = body.length - 1;
      if (last >= 0 && body[last] !== "") {
        body[last] = `${body[last]} ${continuation}`;
      } else {
        body.push(continuation);
      }
      continue;
    }
    body.push(line);
  }

  while (body.length > 0 && body[0] === "") {
    body.shift();
  }
  while (body.length > 0 && body[body.length - 1] === "") {
    body.pop();
  }

  return body.length === 0 ? null : body.join("\n");
}
