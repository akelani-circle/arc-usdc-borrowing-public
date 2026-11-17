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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UcwSessionProvider, useUcwSession } from "@/contexts/UcwSessionContext";
import { useAuthSession } from "@/contexts/AuthContext";

vi.mock("@/contexts/AuthContext", () => ({ useAuthSession: vi.fn() }));
vi.mock("@/lib/activityLog", () => ({ logEvent: vi.fn() }));
vi.mock("@circle-fin/w3s-pw-web-sdk", () => ({
  W3SSdk: class {
    async getDeviceId() {
      return "device";
    }
    setAuthentication() {}
    execute(_id: string, done: (error?: unknown) => void) {
      done();
    }
  },
}));

const mockedUseAuthSession = vi.mocked(useAuthSession);

type Auth = ReturnType<typeof useAuthSession>;
const signedInAs = (id: string) => ({ status: "signed-in", user: { id } }) as unknown as Auth;
const signedOut = { status: "signed-out", user: undefined } as unknown as Auth;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

let hasWallet: Record<string, boolean | "unauthorized"> = {};
let currentUser: string | undefined;
const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/wallet-accounts/me")) {
    const answer = currentUser ? hasWallet[currentUser] : "unauthorized";
    return answer === "unauthorized" || answer === undefined
      ? json({ message: "Not authenticated" }, 401)
      : json({ hasWallet: answer });
  }
  if (url.endsWith("/api/pin/setup") || url.endsWith("/api/pin/token")) {
    return json({ sessionId: `s-${currentUser}`, userToken: `t-${currentUser}`, encryptionKey: "k" });
  }
  if (url.endsWith("/api/wallets/list")) {
    return json({ wallets: [{ id: `w-${currentUser}`, address: "0xabc", blockchain: "ARC-TESTNET" }] });
  }
  if (url.endsWith("/api/wallets/balances")) return json({ tokenBalances: [] });
  return json({ ok: true });
});

function calls(path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(path));
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <UcwSessionProvider>{children}</UcwSessionProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  hasWallet = {};
  currentUser = undefined;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      close() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("UcwSessionProvider sign-out then sign-up in the same tab", () => {
  // Regression: disconnect() re-armed auto-resume while still signed in, so the old user was
  // resumed again mid sign-out. Its answer (a 401 body read as `{ hasWallet: undefined }`)
  // then flagged wallet setup as already tried, and the next user's wallet was never created.
  it("creates the new user's wallet", async () => {
    hasWallet = { alice: true, bob: false };
    currentUser = "alice";
    mockedUseAuthSession.mockReturnValue(signedInAs("alice"));
    const { result, rerender } = renderHook(() => useUcwSession(), { wrapper });
    await waitFor(() => expect(result.current.wallet?.id).toBe("w-alice"));
    expect(calls("/api/wallet-accounts/me")).toHaveLength(1);

    // Sign out: disconnect() first, then Supabase drops the session (and the cookie).
    act(() => result.current.disconnect());
    currentUser = undefined;
    mockedUseAuthSession.mockReturnValue(signedOut);
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls("/api/wallet-accounts/me")).toHaveLength(1);

    currentUser = "bob";
    mockedUseAuthSession.mockReturnValue(signedInAs("bob"));
    rerender();
    await waitFor(() => expect(result.current.wallet?.id).toBe("w-bob"));
    expect(calls("/api/pin/setup")).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("ignores a wallet check that answers after its user signed out", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementationOnce(async () => {
      await gate;
      return new Response(JSON.stringify({ message: "Not authenticated" }), { status: 401 });
    });
    mockedUseAuthSession.mockReturnValue(signedInAs("alice"));
    const { result, rerender } = renderHook(() => useUcwSession(), { wrapper });
    await waitFor(() => expect(calls("/api/wallet-accounts/me")).toHaveLength(1));

    mockedUseAuthSession.mockReturnValue(signedOut);
    rerender();
    release();
    await new Promise((r) => setTimeout(r, 1500));
    expect(result.current.needsWalletSetup).toBe(false);
    expect(result.current.error).toBeNull();
    expect(calls("/api/pin/setup")).toHaveLength(0);
  });
});

describe("UcwSessionProvider withApproval", () => {
  it("passes a signal that disconnect aborts", async () => {
    mockedUseAuthSession.mockReturnValue(signedOut);
    const { result } = renderHook(() => useUcwSession(), { wrapper });
    let seen: AbortSignal | undefined;
    const pending = result.current.withApproval(
      (signal) =>
        new Promise((_, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    act(() => result.current.disconnect());
    await expect(pending).rejects.toBeDefined();
    expect(seen?.aborted).toBe(true);
  });
});
