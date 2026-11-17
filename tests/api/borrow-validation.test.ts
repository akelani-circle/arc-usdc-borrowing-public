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

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KitError } from "@circle-fin/borrow-kit";

import { ALICE, DEFAULT_MARKET_ID, borrowKit, liveSession, post, signIn } from "../helpers/route-mocks";

const MARKET = "0x" + "cd".repeat(32);

async function call(route: string, body: unknown, raw?: string) {
  const mod = await import(/* @vite-ignore */ `${process.cwd()}/app/api/borrow/${route}/route.ts`);
  return mod.POST(post(body, raw));
}

async function asAlice() {
  signIn(ALICE);
  return liveSession(ALICE);
}

describe("amounts", () => {
  const badAmounts = ["0", "-1", "1e3", "0x10", " 1", "1 ", "abc", "", "1.", ".5", "NaN", "Infinity", "1,5", "1".repeat(20), "0.0000000000000000001", "1; DROP TABLE", "1000000000001"];

  it.each(badAmounts)("borrow rejects amount %j", async (amount) => {
    const sessionId = await asAlice();
    const res = await call("borrow", { sessionId, amount });
    expect(res.status).toBe(400);
    expect(borrowKit.borrow).not.toHaveBeenCalled();
  });

  it.each(["repay", "add-collateral", "withdraw-collateral"])("%s rejects a bad amount and does not default a missing one", async (route) => {
    const sessionId = await asAlice();
    expect((await call(route, { sessionId, loanId: "loan-1", amount: "1e3" })).status).toBe(400);
    expect((await call(route, { sessionId, loanId: "loan-1" })).status).toBe(400);
    for (const fn of [borrowKit.repay, borrowKit.addCollateral, borrowKit.withdrawCollateralRepayIfNeeded]) expect(fn).not.toHaveBeenCalled();
  });

  it("does not default the amount on borrow: money must not move by omission", async () => {
    const sessionId = await asAlice();
    expect((await call("borrow", { sessionId })).status).toBe(400);
    expect(borrowKit.borrow).not.toHaveBeenCalled();
  });

  it.each(["1", "0.000001", "12.345678901234567890", "1000000000000"])("accepts %s", async (amount) => {
    const sessionId = await asAlice();
    borrowKit.repay.mockResolvedValue({});
    expect((await call("repay", { sessionId, loanId: "loan-1", amount })).status).toBe(200);
    expect(borrowKit.repay).toHaveBeenCalledWith(expect.objectContaining({ repayAmount: amount }));
  });

  it("quotes still default a missing amount (read-only)", async () => {
    signIn(ALICE);
    borrowKit.getRepayQuote.mockResolvedValue({});
    expect((await call("repay-quote", { loanId: "loan-1" })).status).toBe(200);
    expect(borrowKit.getRepayQuote).toHaveBeenCalledWith(expect.objectContaining({ repayAmount: "0.1" }));
    borrowKit.getAddCollateralQuote.mockResolvedValue({});
    await call("add-collateral-quote", { loanId: "loan-1" });
    expect(borrowKit.getAddCollateralQuote).toHaveBeenCalledWith(expect.objectContaining({ collateralAmount: "0.00001" }));
    borrowKit.getWithdrawCollateralRepayIfNeededQuote.mockResolvedValue({});
    await call("withdraw-collateral-quote", { loanId: "loan-1" });
    expect(borrowKit.getWithdrawCollateralRepayIfNeededQuote).toHaveBeenCalledWith(expect.objectContaining({ collateralAmount: "0.000001" }));
  });

  it("quotes reject a bad amount", async () => {
    signIn(ALICE);
    for (const route of ["repay-quote", "add-collateral-quote", "withdraw-collateral-quote", "required-collateral-quote"]) {
      expect((await call(route, { loanId: "loan-1", amount: "-5" })).status, route).toBe(400);
    }
  });
});

describe("slippage", () => {
  it.each([1001, 10_000, -1, 0.5, "50", true, [50], {}])("borrow rejects %j", async (slippageBps) => {
    const sessionId = await asAlice();
    const res = await call("borrow", { sessionId, amount: "1", slippageBps });
    expect(res.status).toBe(400);
    expect(borrowKit.borrow).not.toHaveBeenCalled();
  });

  it("accepts 0 to 1000 and passes it on", async () => {
    const sessionId = await asAlice();
    borrowKit.closeLoan.mockResolvedValue({});
    for (const slippageBps of [0, 50, 1000]) {
      expect((await call("close", { sessionId, loanId: "loan-1", slippageBps })).status).toBe(200);
      expect(borrowKit.closeLoan).toHaveBeenLastCalledWith(expect.objectContaining({ slippageBps }));
    }
  });

  it("leaves slippage to the SDK default when absent or null", async () => {
    const sessionId = await asAlice();
    borrowKit.closeLoan.mockResolvedValue({});
    await call("close", { sessionId, loanId: "loan-1" });
    await call("close", { sessionId, loanId: "loan-1", slippageBps: null });
    expect(borrowKit.closeLoan.mock.calls[0][0].slippageBps).toBeUndefined();
    expect(borrowKit.closeLoan.mock.calls[1][0].slippageBps).toBeUndefined();
  });

  it("every route that takes it enforces the cap", async () => {
    const sessionId = await asAlice();
    for (const [route, body] of [
      ["close", { loanId: "l" }],
      ["close-quote", { loanId: "l" }],
      ["withdraw-collateral", { loanId: "l", amount: "1" }],
      ["withdraw-collateral-quote", { loanId: "l", amount: "1" }],
      ["borrow-quote", { amount: "1" }],
    ] as const) {
      expect((await call(route, { sessionId, ...body, slippageBps: 5000 })).status, route).toBe(400);
    }
  });
});

describe("ids", () => {
  it.each(["", "a b", "../../etc/passwd", "x".repeat(129), "loan;1", "loan\n1", "<script>", 7, null, {}])("rejects loanId %j", async (loanId) => {
    const sessionId = await asAlice();
    for (const route of ["repay", "close", "add-collateral", "withdraw-collateral"]) {
      expect((await call(route, { sessionId, loanId, amount: "1" })).status, route).toBe(400);
    }
    for (const route of ["repay-quote", "close-quote", "add-collateral-quote", "withdraw-collateral-quote", "loan"]) {
      expect((await call(route, { loanId, amount: "1" })).status, route).toBe(400);
    }
  });

  it("rejects a market id that is not 32 bytes of hex", async () => {
    const sessionId = await asAlice();
    for (const marketId of ["0x1234", "abc", "0x" + "g".repeat(64), "0x" + "a".repeat(65), 5]) {
      expect((await call("borrow", { sessionId, amount: "1", marketId })).status).toBe(400);
      expect((await call("market", { marketId })).status).toBe(400);
      expect((await call("required-collateral-quote", { marketId })).status).toBe(400);
    }
    expect(borrowKit.borrow).not.toHaveBeenCalled();
  });

  it("uses the default market when none is given, and a valid one when it is", async () => {
    const sessionId = await asAlice();
    borrowKit.borrow.mockResolvedValue({});
    await call("borrow", { sessionId, amount: "1" });
    expect(borrowKit.borrow).toHaveBeenLastCalledWith(expect.objectContaining({ marketId: DEFAULT_MARKET_ID }));
    await call("borrow", { sessionId, amount: "1", marketId: MARKET });
    expect(borrowKit.borrow).toHaveBeenLastCalledWith(expect.objectContaining({ marketId: MARKET }));
  });

  it("borrow more on a loan sends the loan id and no market", async () => {
    const sessionId = await asAlice();
    borrowKit.borrow.mockResolvedValue({});
    await call("borrow", { sessionId, amount: "2", loanId: "loan-9", marketId: MARKET });
    const args = borrowKit.borrow.mock.calls[0][0];
    expect(args.loanId).toBe("loan-9");
    expect(args.marketId).toBeUndefined();
    expect(args.borrowAmount).toBe("2");
  });
});

describe("other inputs", () => {
  it("required-collateral-quote bounds the target health factor", async () => {
    signIn(ALICE);
    for (const targetHealthFactor of [1, 0.5, 101, "abc", -2, "Infinity"]) {
      expect((await call("required-collateral-quote", { amount: "1", targetHealthFactor })).status).toBe(400);
    }
    borrowKit.getRequiredCollateral.mockResolvedValue({});
    expect((await call("required-collateral-quote", { amount: "1", targetHealthFactor: "1.5" })).status).toBe(200);
    expect(borrowKit.getRequiredCollateral).toHaveBeenCalledWith(expect.objectContaining({ targetHealthFactor: 1.5, marketId: DEFAULT_MARKET_ID }));
    await call("required-collateral-quote", { amount: "1" });
    expect(borrowKit.getRequiredCollateral).toHaveBeenLastCalledWith(expect.objectContaining({ targetHealthFactor: 2 }));
  });

  it("markets validates the filters and caps the page size", async () => {
    signIn(ALICE);
    for (const body of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: "25" }, { sortBy: "drop" }, { minLltv: 5 }, { maxLltv: "abc" }, { pageAfter: "" }, { pageAfter: "x".repeat(513) }]) {
      expect((await call("markets", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(borrowKit.exploreMarkets).not.toHaveBeenCalled();

    borrowKit.exploreMarkets.mockResolvedValue({ markets: [] });
    expect((await call("markets", { minLltv: "0.5", maxLltv: "0.9", sortBy: "borrowApy", pageSize: 10, pageAfter: "cursor" })).status).toBe(200);
    expect(borrowKit.exploreMarkets).toHaveBeenLastCalledWith({ chain: "Arc_Testnet", minLltv: "0.5", maxLltv: "0.9", sortBy: "borrowApy", pageSize: 10, pageAfter: "cursor" });
    await call("markets", {});
    expect(borrowKit.exploreMarkets.mock.calls[1][0].pageSize).toBe(25);
  });

  it("does not pass unknown fields through to the SDK", async () => {
    signIn(ALICE);
    borrowKit.exploreMarkets.mockResolvedValue({});
    await call("markets", { pageSize: 5, rogue: "x", chain: "Ethereum" });
    expect(borrowKit.exploreMarkets.mock.calls[0][0]).toEqual({ chain: "Arc_Testnet", pageSize: 5 });
  });
});

describe("request bodies", () => {
  it("answers 400, not a stack trace, for a body that is not JSON", async () => {
    signIn(ALICE);
    for (const route of ["borrow", "repay", "market", "markets", "loans", "close-quote"]) {
      const res = await call(route, undefined, "{not json");
      expect(res.status, route).toBe(400);
      expect(await res.json()).toEqual({ message: "Request body must be JSON." });
    }
  });

  it("rejects bodies that are not objects", async () => {
    signIn(ALICE);
    for (const raw of ["[]", "null", "5", '"x"']) {
      expect((await call("markets", undefined, raw)).status, raw).toBe(400);
    }
  });

  it("refuses a body over 16 KiB", async () => {
    signIn(ALICE);
    const res = await call("markets", undefined, JSON.stringify({ pageAfter: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it("treats an empty body as an empty object", async () => {
    signIn(ALICE);
    borrowKit.getMarket.mockResolvedValue({});
    expect((await call("market", undefined, "")).status).toBe(200);
  });
});

describe("rate limits", () => {
  it("allows 20 transactions a minute per user, then answers 429 with Retry-After", async () => {
    const sessionId = await asAlice();
    borrowKit.repay.mockResolvedValue({});
    for (let i = 0; i < 20; i++) {
      expect((await call("repay", { sessionId, loanId: "loan-1", amount: "1" })).status).toBe(200);
    }
    const res = await call("repay", { sessionId, loanId: "loan-1", amount: "1" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(borrowKit.repay).toHaveBeenCalledTimes(20);
  });

  it("counts one user's requests only against that user", async () => {
    const aliceSession = await asAlice();
    borrowKit.repay.mockResolvedValue({});
    for (let i = 0; i < 21; i++) await call("repay", { sessionId: aliceSession, loanId: "loan-1", amount: "1" });

    const { BOB } = await import("../helpers/route-mocks");
    signIn(BOB);
    const { liveSession } = await import("../helpers/route-mocks");
    const bobSession = await liveSession(BOB);
    expect((await call("repay", { sessionId: bobSession, loanId: "loan-1", amount: "1" })).status).toBe(200);
  });

  it("limits read-only calls to 60 a minute", async () => {
    signIn(ALICE);
    borrowKit.getMarket.mockResolvedValue({});
    for (let i = 0; i < 60; i++) expect((await call("market", {})).status).toBe(200);
    expect((await call("market", {})).status).toBe(429);
    expect(borrowKit.getMarket).toHaveBeenCalledTimes(60);
  });

  it("does not spend the limit on requests that fail validation", async () => {
    const sessionId = await asAlice();
    borrowKit.repay.mockResolvedValue({});
    for (let i = 0; i < 50; i++) await call("repay", { sessionId, loanId: "loan-1", amount: "nope" });
    expect((await call("repay", { sessionId, loanId: "loan-1", amount: "1" })).status).toBe(200);
  });
});

describe("error reporting", () => {
  it("logs a failure without dumping the error object", async () => {
    const sessionId = await asAlice();
    const error = Object.assign(new Error("Request failed"), { config: { headers: { Authorization: "Bearer TEST_API_KEY:secret" } }, code: 155101 });
    borrowKit.repay.mockRejectedValue(error);
    const res = await call("repay", { sessionId, loanId: "loan-1", amount: "1" });
    expect(res.status).toBe(500);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).toContain("Request failed");
    expect(logged).not.toContain("TEST_API_KEY");
  });
});

describe("error statuses", () => {
  // Every SDK failure used to come back as a 500.
  it("answers with the status the Borrow Kit error calls for", async () => {
    const sessionId = await asAlice();
    borrowKit.closeLoan.mockRejectedValue(
      new KitError({ name: "BORROW_LOAN_NOT_FOUND", message: "Loan not found", code: 1200, type: "INPUT", recoverability: "FATAL" }),
    );
    const res = await call("close", { sessionId, loanId: "loan-1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 1200, message: "Loan not found" });

    borrowKit.getMarket.mockRejectedValue(
      new KitError({ name: "BORROW_UPSTREAM_UNAVAILABLE", message: "Try later", code: 8204, type: "SERVICE", recoverability: "RETRYABLE" }),
    );
    expect((await call("market", {})).status).toBe(503);
  });
});

describe("API key", () => {
  // Borrow Kit 1.0.0 refuses the key everywhere but borrow and getBorrowQuote.
  it("is passed to borrow and getBorrowQuote only", async () => {
    const sessionId = await asAlice();
    borrowKit.borrow.mockResolvedValue({});
    borrowKit.getBorrowQuote.mockResolvedValue({});
    borrowKit.getLoans.mockResolvedValue({ loans: [] });

    await call("borrow", { sessionId, amount: "1" });
    await call("borrow", { sessionId, amount: "1", loanId: "loan-1" });
    await call("borrow-quote", { sessionId, amount: "1" });
    await call("borrow-quote", { sessionId, amount: "1", loanId: "loan-1" });
    await call("loans", { sessionId });

    const key = { apiKey: "TEST_API_KEY:id:secret" };
    for (const [args] of [...borrowKit.borrow.mock.calls, ...borrowKit.getBorrowQuote.mock.calls]) {
      expect(args.config).toEqual(key);
    }
    expect(borrowKit.borrow).toHaveBeenCalledTimes(2);
    expect(borrowKit.getBorrowQuote).toHaveBeenCalledTimes(2);
    expect(borrowKit.getLoans.mock.calls[0][0]).not.toHaveProperty("config");
  });
});
