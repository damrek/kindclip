import { describe, expect, it } from "vitest";
import { AsyncTask } from "./asyncTask.svelte";

describe("AsyncTask", () => {
  it("runs one action at a time and reports the busy window", async () => {
    const task = new AsyncTask();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = task.run(async () => {
      expect(task.busy).toBe(true);
      await gate;
      return 7;
    });
    const second = await task.run(async () => 9);

    expect(second).toEqual({ status: "skipped" });
    release();
    expect(await first).toEqual({ status: "done", value: 7 });
    expect(task.busy).toBe(false);
  });

  it("turns a failure into a message and always releases the busy flag", async () => {
    const task = new AsyncTask();
    const outcome = await task.run(
      async () => {
        throw new Error("database is locked");
      },
      { describe: (cause) => `failed: ${(cause as Error).message}` },
    );

    expect(outcome.status).toBe("failed");
    expect(task.error).toBe("failed: database is locked");
    expect(task.busy).toBe(false);
  });

  it("logs the raw cause and reloads real state after a failure", async () => {
    const logged: string[] = [];
    let reloads = 0;
    const task = new AsyncTask((scope) => logged.push(scope));

    await task.run(
      async () => {
        throw new Error("disk full");
      },
      {
        scope: "backup",
        afterFailure: () => {
          reloads += 1;
        },
      },
    );

    expect(logged).toEqual(["backup"]);
    expect(reloads).toBe(1);
  });

  it("keeps the failure message when the recovery reload also fails", async () => {
    const task = new AsyncTask();
    const outcome = await task.run(
      async () => {
        throw new Error("original");
      },
      {
        afterFailure: () => {
          throw new Error("reload failed");
        },
      },
    );

    expect(outcome.status).toBe("failed");
    expect(task.error).toBe("original");
    expect(task.busy).toBe(false);
  });

  it("sets the pending line, clears the previous error and runs the success hook", async () => {
    const task = new AsyncTask();
    task.error = "old error";
    task.status = "old status";
    let done = 0;

    const outcome = await task.run(async () => "ok", {
      pending: "saving…",
      afterSuccess: () => {
        done += 1;
      },
    });

    expect(outcome).toEqual({ status: "done", value: "ok" });
    expect(task.status).toBe("saving…");
    expect(task.error).toBeNull();
    expect(done).toBe(1);
  });
});
