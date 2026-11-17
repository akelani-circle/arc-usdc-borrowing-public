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
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBorrowState } from "@/hooks/useBorrowState";
import { ApiError, postJson } from "@/lib/api";
import { useUcwSession } from "@/contexts/UcwSessionContext";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, postJson: vi.fn() };
});

vi.mock("@/contexts/UcwSessionContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/UcwSessionContext")>();
  return { ...actual, useUcwSession: vi.fn() };
});

const mockedPostJson = vi.mocked(postJson);
const mockedUseUcwSession = vi.mocked(useUcwSession);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function loansCalls() {
  return mockedPostJson.mock.calls.filter(([path]) => path === "/api/borrow/loans");
}

beforeEach(() => {
  mockedPostJson.mockReset();
  mockedPostJson.mockImplementation((path: string) => {
    if (path === "/api/borrow/market") return Promise.resolve({});
    if (path === "/api/borrow/loans") return Promise.resolve({ walletAddress: "0xabc", loans: [] });
    return Promise.resolve({});
  });
});

describe("useBorrowState loans query gating", () => {
  // Regression test: right after a wallet is created, `session.sessionId` goes
  // truthy well before the Circle wallet's signing method is actually
  // established server-side. Gating the loans query on sessionId alone made
  // it fire immediately and fail repeatedly (KitError code 1098) until the
  // wallet showed up. It must also wait for `wallet`.
  it("does not call /api/borrow/loans while session exists but wallet hasn't loaded yet", async () => {
    mockedUseUcwSession.mockReturnValue({
      session: { sessionId: "sess-1", userToken: "tok", encryptionKey: "key" },
      wallet: undefined,
    } as ReturnType<typeof useUcwSession>);

    renderHook(() => useBorrowState(), { wrapper });

    await waitFor(() => {
      expect(mockedPostJson).toHaveBeenCalledWith("/api/borrow/market", {});
    });

    expect(loansCalls()).toHaveLength(0);
  });

  it("calls /api/borrow/loans once both session and wallet are present", async () => {
    mockedUseUcwSession.mockReturnValue({
      session: { sessionId: "sess-1", userToken: "tok", encryptionKey: "key" },
      wallet: { id: "w1", address: "0xabc", blockchain: "ARC-TESTNET" },
    } as ReturnType<typeof useUcwSession>);

    renderHook(() => useBorrowState(), { wrapper });

    await waitFor(() => {
      expect(loansCalls()).toHaveLength(1);
    });
    expect(loansCalls()[0][1]).toEqual({ sessionId: "sess-1" });
  });

  // The market route needs a signed-in user; it used to be polled while signed out too.
  it("calls neither route with no session at all", async () => {
    mockedUseUcwSession.mockReturnValue({
      session: undefined,
      wallet: undefined,
    } as ReturnType<typeof useUcwSession>);

    renderHook(() => useBorrowState(), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockedPostJson).not.toHaveBeenCalled();
  });
});

const signedIn = {
  session: { sessionId: "sess-1", userToken: "tok", encryptionKey: "key" },
  wallet: { id: "w1", address: "0xabc", blockchain: "ARC-TESTNET" },
} as ReturnType<typeof useUcwSession>;

describe("useBorrowState active loan", () => {
  // getLoans also returns closed loans. Taking loans[0] kept a closed loan on screen as
  // "Active", with Close and Borrow more buttons that could only fail.
  it("ignores closed loans", async () => {
    mockedUseUcwSession.mockReturnValue(signedIn);
    mockedPostJson.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/borrow/loans"
          ? { walletAddress: "0xabc", loans: [{ loanId: "old", status: "closed" }, { loanId: "new", status: "active" }] }
          : {},
      ),
    );

    const { result } = renderHook(() => useBorrowState(), { wrapper });
    await waitFor(() => expect(result.current.activeLoanId).toBe("new"));
    expect(result.current.position).toMatchObject({ loanId: "new" });
  });

  it("has no active loan when every loan is closed", async () => {
    mockedUseUcwSession.mockReturnValue(signedIn);
    mockedPostJson.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/borrow/loans" ? { walletAddress: "0xabc", loans: [{ loanId: "old", status: "closed" }] } : {},
      ),
    );

    const { result } = renderHook(() => useBorrowState(), { wrapper });
    await waitFor(() => expect(result.current.loans).toHaveLength(1));
    expect(result.current.activeLoanId).toBeUndefined();
    expect(result.current.position).toBeUndefined();
  });
});

describe("useBorrowState retries", () => {
  function retryingWrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { refetchInterval: false, retryDelay: 1 } },
    });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  // Code 1098 is Borrow Kit's generic validation failure, not "wallet not ready yet". It was
  // retried ten times; a 4xx fails the same way every time, so it isn't retried at all.
  it("does not retry a 4xx", async () => {
    mockedUseUcwSession.mockReturnValue(signedIn);
    mockedPostJson.mockImplementation((path: string) =>
      path === "/api/borrow/loans"
        ? Promise.reject(new ApiError({ message: "Validation failed", code: 1098, recoverability: "FATAL" }, 400))
        : Promise.resolve({}),
    );

    const { result } = renderHook(() => useBorrowState(), { wrapper: retryingWrapper });
    await waitFor(() => expect(result.current.isLoansLoading).toBe(false));
    expect(loansCalls()).toHaveLength(1);
  });

  it("retries a 5xx", async () => {
    mockedUseUcwSession.mockReturnValue(signedIn);
    mockedPostJson.mockImplementation((path: string) =>
      path === "/api/borrow/loans"
        ? Promise.reject(new ApiError({ message: "Service unavailable", code: 8204 }, 503))
        : Promise.resolve({}),
    );

    const { result } = renderHook(() => useBorrowState(), { wrapper: retryingWrapper });
    await waitFor(() => expect(result.current.isLoansLoading).toBe(false));
    expect(loansCalls()).toHaveLength(4);
  });
});

describe("useBorrowState refetchAll", () => {
  // Regression coverage: a loan action (open/borrow/repay/close) settles
  // on-chain and then needs a moment before Borrow Kit's getLoans reflects
  // it — the same class of lag as the wallet-indexing case above. A single
  // invalidate right after the action can win that race and leave the
  // health card showing stale figures, so refetchAll schedules a couple of
  // follow-up refetches instead of relying on the 15s background interval.
  it("triggers an immediate refetch and schedules two follow-up refetches", async () => {
    mockedUseUcwSession.mockReturnValue({
      session: { sessionId: "sess-1", userToken: "tok", encryptionKey: "key" },
      wallet: { id: "w1", address: "0xabc", blockchain: "ARC-TESTNET" },
    } as ReturnType<typeof useUcwSession>);

    const { result } = renderHook(() => useBorrowState(), { wrapper });
    await waitFor(() => expect(loansCalls()).toHaveLength(1));

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    result.current.refetchAll();

    // The delay:0 branch invalidates synchronously (no setTimeout needed).
    await waitFor(() => expect(loansCalls().length).toBeGreaterThan(1));
    // The two follow-up refetches are scheduled via setTimeout rather than
    // fired immediately — assert the delays without waiting them out in
    // real time.
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    expect(delays).toContain(2_000);
    expect(delays).toContain(5_000);

    setTimeoutSpy.mockRestore();
  });
});
