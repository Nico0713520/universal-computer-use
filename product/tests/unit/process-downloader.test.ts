import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDownloader } from "../../src/cli/process-runner.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDestination(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ucu-downloader-test-"));
  temporaryRoots.push(root);
  return join(root, "installer.sh");
}

describe("locked installer downloader", () => {
  it("uses a finite request deadline and writes the response exactly once", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async (_input: URL, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const destination = await temporaryDestination();

    await fetchDownloader.download(new URL("https://example.test/install.sh"), destination);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://example.test/install.sh"),
      {
        redirect: "follow",
        signal: expect.any(AbortSignal),
      },
    );
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect([...await readFile(destination)]).toEqual([1, 2, 3]);
  });

  it("does not leave a destination file when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network unavailable"); }));
    const destination = await temporaryDestination();

    await expect(
      fetchDownloader.download(new URL("https://example.test/install.sh"), destination),
    ).rejects.toThrow("network unavailable");
    await expect(access(destination)).rejects.toThrow();
  });
});
