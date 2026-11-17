/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { insert, single } = vi.hoisted(() => ({ insert: vi.fn(), single: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({ from: () => ({ insert }) }),
}));

type ActivityLogModule = typeof import("@/lib/activityLog");

async function loadModule(): Promise<ActivityLogModule> {
  vi.resetModules();
  return import("@/lib/activityLog");
}

// Supabase resolves with a plain `{ message }` object on failure. It never rejects.
const networkDown = { data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" } };
const rlsDenied = {
  data: null,
  error: { message: 'new row violates row-level security policy for table "activity_log"', details: null, hint: null, code: "42501" },
};

let nextRemoteId = 100;
/** Each successful insert returns a new row id, like Postgres does. */
function savesSucceed() {
  single.mockImplementation(async () => ({ data: { id: nextRemoteId++ }, error: null }));
}

beforeEach(() => {
  insert.mockReset();
  insert.mockImplementation(() => ({ select: () => ({ single }) }));
  single.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("activity log persistence", () => {
  it("marks an entry as saved and takes the Supabase row id when the insert succeeds", async () => {
    single.mockResolvedValue({ data: { id: 42 }, error: null });
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));
    expect(result.current[0]?.persistence).toBe("pending");

    await waitFor(() => expect(result.current[0]?.persistence).toBe("saved"));
    expect(result.current[0]?.id).toBe(42);
    expect(insert).toHaveBeenCalledWith({ label: "Borrow", data: { amount: 1 } });
  });

  it("shows Supabase's error message when the insert is refused", async () => {
    single.mockResolvedValue(rlsDenied);
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));

    await waitFor(() => expect(result.current[0]?.persistence).toBe("failed"));
    expect(result.current[0]?.persistenceError).toBe(rlsDenied.error.message);
    expect(console.error).toHaveBeenCalled();
  });

  it("marks an entry as failed when the request never reaches Supabase", async () => {
    single.mockResolvedValue(networkDown);
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));

    await waitFor(() => expect(result.current[0]?.persistence).toBe("failed"));
    expect(result.current[0]?.persistenceError).toBe("TypeError: Failed to fetch");
  });

  it("retries a single failed entry", async () => {
    single.mockResolvedValue(networkDown);
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));
    await waitFor(() => expect(result.current[0]?.persistence).toBe("failed"));

    savesSucceed();
    act(() => log.retryPersistence(result.current[0].id));

    await waitFor(() => expect(result.current[0]?.persistence).toBe("saved"));
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("retries every failed entry at once", async () => {
    single.mockResolvedValue(networkDown);
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => {
      log.logEvent("Borrow", { amount: 1 });
      log.logEvent("Repay", { amount: 2 });
    });
    await waitFor(() => expect(result.current.every((e) => e.persistence === "failed")).toBe(true));

    savesSucceed();
    act(() => log.retryFailedEntries());

    await waitFor(() => expect(result.current.every((e) => e.persistence === "saved")).toBe(true));
    expect(result.current.map((e) => e.label)).toEqual(["Borrow", "Repay"]);
    expect(insert).toHaveBeenCalledTimes(4);
  });

  it("marks rows loaded from Supabase as saved, oldest first", async () => {
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() =>
      log.hydrateFromRemote([
        { id: 2, label: "Repay", data: { amount: 2 }, created_at: "2026-01-01T00:00:01Z" },
        { id: 1, label: "Borrow", data: { amount: 1 }, created_at: "2026-01-01T00:00:00Z" },
      ]),
    );

    expect(result.current.map((entry) => entry.persistence)).toEqual(["saved", "saved"]);
    expect(result.current.map((entry) => entry.label)).toEqual(["Borrow", "Repay"]);
    expect(insert).not.toHaveBeenCalled();
  });

  // Supabase reloads the log whenever the tab regains focus. A failed entry exists only in
  // this tab, so the reload must not wipe it before the user can retry.
  it("keeps failed entries when the log is reloaded from Supabase", async () => {
    single.mockResolvedValue(networkDown);
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));
    await waitFor(() => expect(result.current[0]?.persistence).toBe("failed"));

    act(() =>
      log.hydrateFromRemote([
        { id: 7, label: "Repay", data: { amount: 2 }, created_at: "2000-01-01T00:00:00Z" },
      ]),
    );

    expect(result.current.map((e) => [e.label, e.persistence])).toEqual([
      ["Repay", "saved"],
      ["Borrow", "failed"],
    ]);
  });

  it("does not show an entry twice when a reload already brought in its saved row", async () => {
    let finishSave: (value: unknown) => void = () => {};
    single.mockReturnValue(new Promise((resolve) => (finishSave = resolve)));
    const log = await loadModule();
    const { result } = renderHook(() => log.useActivityLog());

    act(() => log.logEvent("Borrow", { amount: 1 }));
    // The row lands in Supabase and a reload picks it up before this tab hears back.
    act(() =>
      log.hydrateFromRemote([
        { id: 9, label: "Borrow", data: { amount: 1 }, created_at: new Date().toISOString() },
      ]),
    );
    expect(result.current).toHaveLength(2);

    await act(async () => finishSave({ data: { id: 9 }, error: null }));

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: 9, persistence: "saved" });
  });
});
