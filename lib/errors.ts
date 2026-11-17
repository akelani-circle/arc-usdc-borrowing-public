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

import { ApiError } from "@/lib/api";

/**
 * User-friendly messages keyed by the numeric `KitError` codes Borrow Kit and the Circle wallet
 * adapter really throw (checked against the installed SDKs' error registries). 1200-1225 are
 * Borrow input errors: fix the request before retrying. 8200-8204 are transient service errors.
 */
const MESSAGES: Record<number, string> = {
  // The Borrow Service answered 422 without a more specific code, e.g. a close the wallet can't pay for.
  1007: "The Borrow Service couldn't process this. Check your wallet holds enough USDC and cirBTC for it.",
  1099: "You cancelled the PIN approval.",
  1200: "That loan ID doesn't exist or has already been closed.",
  1201: "Your approval signature was missing, expired, or invalid. Try again.",
  1202: "This loan belongs to a different wallet.",
  1203: "The webhook URL is invalid.",
  1204: "One of the request parameters is invalid.",
  1205: "That blockchain isn't supported.",
  1206: "Integrator config is missing.",
  1207: "That market doesn't exist.",
  1208: "Revoke your existing Morpho authorization before retrying.",
  1209: "That market/chain combination isn't supported.",
  1210: "This request conflicts with a previous one — try again.",
  1211: "This would drop your loan below a safe health factor. Try a smaller amount.",
  1212: "This loan is liquidatable — you can't add more debt to it.",
  1213: "That quote expired — get a fresh one and try again.",
  1214: "You already have a loan in this market — grow the existing one instead.",
  1215: "That request already went through. Refresh to see the result.",
  1216: "That's more collateral than the loan holds.",
  1217: "That's more than the loan owes. Use Close loan to repay everything.",
  1219: "You've reached the maximum number of open loans.",
  1220: "This market's data isn't available right now. Try again later.",
  1222: "Your existing loan in this market can't be used here.",
  1223: "This loan has no debt left. Borrow against it first.",
  1224: "Your wallet doesn't hold enough cirBTC for this loan. Add cirBTC or borrow less.",
  3001: "Can't reach the network. Please try again.",
  // The wallet adapter gave up waiting, but Circle doesn't cancel the challenge: approving it
  // later still sends the transaction.
  3002: "The PIN approval timed out. It wasn't cancelled, so refresh to check your loan before trying again.",
  5001: "The transaction failed on-chain.",
  5002: "The transaction would fail on-chain, so it wasn't sent.",
  7001: "Too many requests. Wait a moment and try again.",
  8200: "A transient backend error occurred — please retry.",
  8201: "The SDK is out of date for this response — please retry.",
  8202: "Temporary issue fetching reward data — please retry.",
  8203: "Your loan data is still updating. Try again in a moment.",
  8204: "The Borrow Service is temporarily unavailable. Try again in a moment.",
  9001: "Your wallet doesn't hold enough of this token.",
  9002: "Your wallet doesn't hold enough USDC to pay the network fee.",
};

const UNREVOKED_TIMEOUT = 3002;

export interface FriendlyError {
  /** Always safe to render — plain language, no stack traces or hex blobs. */
  title: string;
  /** Extra context, only set when the underlying text reads like a sentence. */
  detail?: string;
  retryable: boolean;
  /** The raw text, for the activity log. Never rendered in the UI. */
  technical?: string;
}

const GENERIC: FriendlyError = {
  title: "Something went wrong. Please try again.",
  retryable: true,
};

/**
 * Raw messages we know we'll see from fetch, the RPC layer, Next.js error
 * pages and the wallet SDK. Matched in order — first hit wins — so keep the
 * specific patterns above the broad ones.
 */
const PATTERNS: Array<{ test: RegExp; title: string; retryable: boolean }> = [
  {
    test: /complete pin login/i,
    title: "Please log in first.",
    retryable: false,
  },
  {
    test: /unknown session|sessionid required|session (has )?expired|not authenticated|jwt|401/i,
    title: "Your session expired. Sign in again.",
    retryable: false,
  },
  {
    test: /open \/api\/events|not connected|sse/i,
    title: "Your wallet connection isn't ready yet. Give it a second and retry.",
    retryable: true,
  },
  {
    test: /\b(cancell?ed|dismissed)\b|user (rejected|denied)|request rejected/i,
    title: "You cancelled the request.",
    retryable: true,
  },
  {
    test: /incorrect pin|wrong pin|pin code|invalid pin/i,
    title: "That PIN wasn't accepted. Try again.",
    retryable: true,
  },
  {
    test: /challenge/i,
    title: "The PIN approval didn't go through. Try again.",
    retryable: true,
  },
  {
    test: /insufficient (funds|balance)|exceeds balance|gas required exceeds/i,
    title: "Not enough funds to cover this transaction and its fee.",
    retryable: false,
  },
  {
    test: /execution reverted|revert|0x[0-9a-f]{16,}/i,
    title: "The network rejected this transaction.",
    retryable: true,
  },
  {
    test: /nonce|already known|replacement transaction/i,
    title: "A previous transaction is still settling. Wait a moment and retry.",
    retryable: true,
  },
  {
    test: /rate limit|too many requests|429/i,
    title: "Too many requests. Wait a moment and try again.",
    retryable: true,
  },
  {
    test: /timeout|timed out|etimedout|deadline exceeded|aborted/i,
    title: "That took too long. Please try again.",
    retryable: true,
  },
  {
    test: /failed to fetch|fetch failed|network\s?error|load failed|econnrefused|enotfound|offline/i,
    title: "Can't reach the server. Check your connection and try again.",
    retryable: true,
  },
  {
    test: /non-json from|<!doctype|<html|internal server error|bad gateway|service unavailable|50[0-9]/i,
    title: "The server hit a problem. Please try again.",
    retryable: true,
  },
];

/** Strips the SDK's internal call-site prefix, e.g. "Borrow Service getX failed: ". */
function stripInternalPrefix(msg: string): string {
  return msg.replace(/^[\w ]*(service|client|api)\s+\w+\s+failed:\s*/i, "").trim();
}

/**
 * True when a message reads like a sentence written for a person, rather than
 * a stack trace, a JSON blob, a hex payload or an ALL_CAPS enum name.
 */
function isPresentable(msg: string): boolean {
  if (!msg || msg.length > 200) return false;
  if (/[{}[\]<>|]|0x[0-9a-f]{8,}|\bat .+:\d+|https?:\/\/|\n/i.test(msg)) return false;
  if (/^[A-Z0-9_]{6,}$/.test(msg)) return false;
  if (/\b(undefined|null|NaN|\[object)\b/.test(msg)) return false;
  // A sentence has spaces and at least one lowercase run.
  return /\s/.test(msg) && /[a-z]{3}/.test(msg);
}

/** Maps any raw error text onto a message that's safe to put in front of a user. */
export function humanize(raw: unknown): FriendlyError {
  const technical = rawMessage(raw);
  if (!technical) return GENERIC;

  for (const { test, title, retryable } of PATTERNS) {
    if (test.test(technical)) return { title, retryable, technical };
  }

  const clean = stripInternalPrefix(technical);
  if (isPresentable(clean)) return { title: clean, retryable: false, technical };

  return { ...GENERIC, technical };
}

/**
 * The wallet SDK rejects with a plain `{ code?, message }` object, not a real
 * `Error` — `String(err)` on that yields "[object Object]", so pull
 * `.message` out explicitly before falling back.
 */
export function rawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (err === null || err === undefined) return "";
  const str = String(err);
  return str === "[object Object]" ? "" : str;
}

export function parseKitError(error: unknown): FriendlyError {
  if (error instanceof ApiError) {
    // The SDK flags a timed-out PIN approval (3002) as retryable, but the challenge is still live:
    // retrying blindly could send the transaction twice.
    const retryable =
      (error.recoverability === "RETRYABLE" || error.recoverability === "RESUMABLE") &&
      error.code !== UNREVOKED_TIMEOUT;
    const mapped = error.code !== undefined ? MESSAGES[error.code] : undefined;
    const clean = stripInternalPrefix(error.message);

    if (mapped) {
      return {
        title: mapped,
        detail: isPresentable(clean) && clean !== mapped ? clean : undefined,
        retryable,
        technical: error.message,
      };
    }

    const fallback = humanize(error.message);
    // A recoverability flag from the SDK beats our pattern guess.
    return { ...fallback, retryable: retryable || fallback.retryable };
  }

  return humanize(error);
}

/** Supabase auth messages, rewritten for humans. */
export function parseAuthError(error: unknown): FriendlyError {
  const technical = rawMessage(error);
  const map: Array<[RegExp, string]> = [
    [/invalid login credentials/i, "That email or password isn't right."],
    [/email not confirmed/i, "Confirm your email address first — check your inbox."],
    [/user already registered|already been registered/i, "There's already an account with that email."],
    [/password should be at least (\d+)/i, "Your password needs to be at least $1 characters."],
    [/unable to validate email|invalid email/i, "That email address doesn't look right."],
    [/email rate limit|for security purposes/i, "Too many attempts. Wait a minute and try again."],
    [/signups? not allowed|disabled/i, "New sign-ups are turned off right now."],
  ];

  for (const [test, title] of map) {
    const match = technical.match(test);
    if (match) return { title: title.replace("$1", match[1] ?? ""), retryable: false, technical };
  }

  return humanize(error);
}
