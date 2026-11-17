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

import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { humanize, parseAuthError, parseKitError } from "@/lib/errors";

describe("parseKitError", () => {
  it("maps a known KitError code to a friendly, actionable title", () => {
    const err = new ApiError(
      {
        message:
          "Borrow Service getCloseLoanQuote failed: The wallet does not hold enough of the loan asset to cover the repayment this withdrawal requires.",
        code: 1007,
        name: "INPUT_INSUFFICIENT_SWAP_AMOUNT",
        type: "INPUT",
        recoverability: "FATAL",
      },
      422,
    );

    const parsed = parseKitError(err);
    expect(parsed.title).toBe(
      "The Borrow Service couldn't process this. Check your wallet holds enough USDC and cirBTC for it.",
    );
    // The SDK's own sentence is kept as detail, minus its internal call-site prefix.
    expect(parsed.detail).toBe(
      "The wallet does not hold enough of the loan asset to cover the repayment this withdrawal requires.",
    );
    expect(parsed.technical).toContain("getCloseLoanQuote");
    expect(parsed.retryable).toBe(false);
  });

  it("reuses a readable raw message for an unmapped code", () => {
    const err = new ApiError({ message: "Something unusual happened", code: 9999 }, 500);
    expect(parseKitError(err).title).toBe("Something unusual happened");
  });

  it("marks RETRYABLE/RESUMABLE errors as safe to retry", () => {
    const err = new ApiError(
      { message: "A transient backend error occurred", code: 8200, recoverability: "RETRYABLE" },
      500,
    );
    expect(parseKitError(err).retryable).toBe(true);
  });

  // An unapproved challenge isn't revoked when the adapter stops waiting: "start again" could
  // send the transaction twice.
  it("warns that a timed-out PIN approval can still go through", () => {
    const err = new ApiError(
      {
        message:
          "Network timeout on circle-ucw: The challenge was not revoked: if the owner approves it later, the transaction may still execute on-chain. Surface this to the user before retrying.",
        code: 3002,
        type: "NETWORK",
        recoverability: "RETRYABLE",
      },
      504,
    );
    const parsed = parseKitError(err);
    expect(parsed.title).toBe(
      "The PIN approval timed out. It wasn't cancelled, so refresh to check your loan before trying again.",
    );
    expect(parsed.retryable).toBe(false);
  });

  it("never puts a revert blob in front of the user", () => {
    const err = new ApiError(
      { message: "execution reverted: 0xfb8f41b200000000000000000000000000000000" },
      500,
    );
    const parsed = parseKitError(err);
    expect(parsed.title).toBe("The network rejected this transaction.");
    expect(parsed.detail).toBeUndefined();
    expect(parsed.technical).toContain("0xfb8f41b2");
  });
});

describe("humanize", () => {
  it("rewrites a dropped connection", () => {
    expect(humanize(new TypeError("Failed to fetch")).title).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it("rewrites an HTML error page", () => {
    const parsed = humanize(
      new Error("Non-JSON from /api/borrow/borrow (502): <html>Bad Gateway</html>"),
    );
    expect(parsed.title).toBe("The server hit a problem. Please try again.");
    expect(parsed.retryable).toBe(true);
  });

  it("rewrites an expired session", () => {
    expect(humanize(new Error("Unknown session")).title).toBe(
      "Your session expired. Sign in again.",
    );
  });

  it("falls back to a generic message for an ALL_CAPS enum name", () => {
    expect(humanize(new Error("INPUT_VALIDATION_FAILED")).title).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("keeps a message that already reads like a sentence", () => {
    expect(humanize(new Error("The quote you used has expired.")).title).toBe(
      "The quote you used has expired.",
    );
  });
});

describe("parseAuthError", () => {
  it("rewrites Supabase's credential error", () => {
    expect(parseAuthError(new Error("Invalid login credentials")).title).toBe(
      "That email or password isn't right.",
    );
  });

  it("keeps the minimum length from the password rule", () => {
    expect(parseAuthError(new Error("Password should be at least 6 characters")).title).toBe(
      "Your password needs to be at least 6 characters.",
    );
  });
});
