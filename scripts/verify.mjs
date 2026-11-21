#!/usr/bin/env node
/**
 * Run the local quality gate in parallel.
 *
 * Sequentially, `npm run check`, `npm run lint`, `npm run test` and
 * `npm run comments` cost about 12s together. They are independent — none reads
 * another's output — so the slowest one sets the wall clock instead of the sum,
 * around 3.5s with the incremental svelte-check cache warm.
 *
 * Each gate's output is buffered so three concurrent runs never interleave a
 * spinner or a progress line. A gate that passes prints one line; a gate that
 * fails prints its whole output under its own heading.
 */
import { spawn } from "node:child_process";

const GATES = ["check", "lint", "test", "comments"];

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text) => paint("32", text);
const red = (text) => paint("31", text);
const dim = (text) => paint("2", text);

/** Run one npm script, capturing everything it writes. */
function runGate(name) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn("npm", ["run", "--silent", name], {
      // npm is a .cmd shim on Windows, which needs a shell to be resolved.
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    const finish = (ok) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ name, ok, output, seconds: (ms / 1000).toFixed(1) });
    };

    child.on("error", (error) => {
      output += String(error);
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}

const failures = [];

// Print each result as it lands, so the fastest gate is visible while the
// slowest one is still running.
await Promise.all(
  GATES.map(async (name) => {
    const result = await runGate(name);
    const mark = result.ok ? green("✔") : red("✖");
    console.log(`${mark} ${result.name.padEnd(5)} ${dim(`${result.seconds}s`)}`);
    if (!result.ok) {
      failures.push(result);
    }
  }),
);

for (const failure of failures) {
  console.log(`\n${red(`--- ${failure.name} ---`)}\n${failure.output.trimEnd()}`);
}

if (failures.length > 0) {
  console.log(`\n${red(`${failures.length} of ${GATES.length} gates failed`)}`);
  process.exitCode = 1;
} else {
  console.log(`\n${green(`all ${GATES.length} gates passed`)}`);
}
