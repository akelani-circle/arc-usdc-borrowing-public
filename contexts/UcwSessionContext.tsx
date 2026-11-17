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

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, postJson } from "@/lib/api";
import { logEvent } from "@/lib/activityLog";
import { humanize } from "@/lib/errors";
import { useAuthSession } from "@/contexts/AuthContext";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

// A wallet just created via a PIN challenge can take a few seconds to be
// indexed before it shows up in listWallets — poll for it instead of
// giving up after a single check.
const WALLET_INDEX_RETRIES = 8;
const WALLET_INDEX_RETRY_DELAY = 2_000;

// Right after Supabase signs a user in (sign-up or sign-in), our own API
// routes derive the caller from the Supabase auth cookie — which can lag a
// beat behind the client-side auth state that triggers this call, especially
// now that wallet creation auto-starts the instant we're signed in. Retry
// through that narrow window instead of surfacing a scary "Not
// authenticated" error for what's actually just a timing gap.
const AUTH_COOKIE_RETRIES = 3;
const AUTH_COOKIE_RETRY_DELAY = 400;

async function postJsonWithAuthRetry<T>(endpoint: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson<T>(endpoint, body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && attempt < AUTH_COOKIE_RETRIES) {
        await new Promise((r) => setTimeout(r, AUTH_COOKIE_RETRY_DELAY));
        continue;
      }
      throw err;
    }
  }
}

async function getJsonWithAuthRetry<T>(endpoint: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint);
    if (res.status === 401 && attempt < AUTH_COOKIE_RETRIES) {
      await new Promise((r) => setTimeout(r, AUTH_COOKIE_RETRY_DELAY));
      continue;
    }
    const data = await res.json().catch(() => null);
    // An error body is not the data: `{ message: "Not authenticated" }` read as
    // `{ hasWallet }` used to look like "this user has no wallet".
    if (!res.ok) {
      throw new ApiError({ ...data, message: data?.message || `Request failed (${res.status})` }, res.status);
    }
    return data as T;
  }
}

export interface BrowserSession {
  sessionId: string;
  userToken: string;
  encryptionKey: string;
}

export interface WalletInfo {
  id: string;
  address: string;
  blockchain: string;
}

export interface TokenBalance {
  symbol: string;
  amount: string;
}

interface UcwSessionValue {
  session: BrowserSession | undefined;
  wallet: WalletInfo | undefined;
  balances: TokenBalance[];
  sseReady: boolean;
  isBusy: boolean;
  error: string | null;
  /** True once a signed-in user has been checked against Circle and found to have no wallet yet. */
  needsWalletSetup: boolean;
  createWallet: () => Promise<void>;
  continueWithPin: () => Promise<void>;
  resetPin: () => Promise<void>;
  recoverPin: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  /**
   * Runs a request that ends in a PIN challenge. The signal aborts it if the user dismisses
   * the challenge, so the action fails right away instead of waiting out the server's
   * 10-minute approval timeout.
   */
  withApproval: <T>(request: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  disconnect: () => void;
}

const UcwSessionContext = createContext<UcwSessionValue | null>(null);

export function useUcwSession() {
  const ctx = useContext(UcwSessionContext);
  if (!ctx) throw new Error("useUcwSession must be used within UcwSessionProvider");
  return ctx;
}

/** Complete a UCW PIN/passkey challenge with the W3S browser SDK. */
async function executeChallenge(session: {
  userToken: string;
  encryptionKey: string;
  challengeId: string;
}) {
  const sdk = new W3SSdk({ appSettings: { appId: appId ?? "" } });
  // Required before execute() — it establishes the SDK's iframe session with
  // Circle. Skipping it makes execute() fail silently (no error, no
  // success), which looks like the wallet just never gets created.
  await sdk.getDeviceId();
  sdk.setAuthentication({
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
  });

  return new Promise<void>((resolve, reject) => {
    sdk.execute(session.challengeId, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function UcwSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user, status: authStatus } = useAuthSession();
  const [session, setSession] = useState<BrowserSession | undefined>();
  const [wallet, setWallet] = useState<WalletInfo | undefined>();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [sseReady, setSseReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsWalletSetup, setNeedsWalletSetup] = useState(false);
  const eventSourceRef = useRef<EventSource | undefined>(undefined);
  const sessionRef = useRef<BrowserSession | undefined>(undefined);
  const autoResumeAttempted = useRef(false);
  const autoCreateAttempted = useRef(false);
  const approvalRef = useRef<AbortController | undefined>(undefined);
  const userIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user]);

  const loadWallet = useCallback(async (userToken: string, retries = 0) => {
    let wallets: WalletInfo[] = [];
    for (let attempt = 0; ; attempt++) {
      const res = await postJson<{ wallets?: WalletInfo[] }>("/api/wallets/list", { userToken });
      wallets = res.wallets ?? [];
      if (wallets.length > 0 || attempt >= retries) break;
      // Freshly created wallets can take a few seconds to show up in listWallets.
      await new Promise((r) => setTimeout(r, WALLET_INDEX_RETRY_DELAY));
    }
    const w = wallets[0];
    setWallet(w);
    if (!w) {
      setBalances([]);
      if (retries > 0) {
        setError("Wallet creation is taking longer than expected. Try again in a moment.");
      }
      return;
    }
    // Found it — clear out any error left over from an earlier failed step
    // (e.g. a PIN challenge's security-question sub-step erroring even
    // though the wallet itself was created fine underneath it).
    setError(null);
    // Fire-and-forget cache write — keeps wallet_accounts self-healing without blocking the UI.
    // A failure is logged, not swallowed: without the row the next sign-in can't find the wallet.
    void postJson("/api/wallet-accounts/sync", {
      walletId: w.id,
      address: w.address,
      blockchain: w.blockchain,
    }).catch((err) => logEvent("Save wallet — error", humanize(err)));
    const { tokenBalances = [] } = await postJson<{
      tokenBalances?: { amount: string; token: { symbol?: string; name?: string } }[];
    }>("/api/wallets/balances", { userToken, walletId: w.id });
    const seen = new Set<string>();
    const parts: TokenBalance[] = [];
    for (const b of tokenBalances) {
      const symbol = b.token.symbol ?? b.token.name ?? "?";
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      parts.push({ symbol, amount: b.amount });
    }
    setBalances(parts);
  }, []);

  const bindSession = useCallback(
    (next: BrowserSession) => {
      setSession(next);
      sessionRef.current = next;
      eventSourceRef.current?.close();

      const es = new EventSource(`/api/events?sessionId=${next.sessionId}`);
      eventSourceRef.current = es;

      es.addEventListener("ready", () => setSseReady(true));

      es.addEventListener("challenge", (event) => {
        const { challengeId } = JSON.parse((event as MessageEvent).data);
        void (async () => {
          const auth = sessionRef.current;
          if (!auth) return;
          await executeChallenge({
            userToken: auth.userToken,
            encryptionKey: auth.encryptionKey,
            challengeId,
          });
        })().catch((err) => {
          // The request that raised this challenge would otherwise keep waiting for an
          // approval that can no longer come.
          approvalRef.current?.abort(err);
          setError(humanize(err).title);
        });
      });

      es.onerror = () => setSseReady(false);
    },
    [],
  );

  const runAuthFlow = useCallback(
    async (endpoint: string, needsChallenge: boolean) => {
      setIsBusy(true);
      setError(null);
      try {
        // userId is derived server-side from the authenticated Supabase user —
        // the request body is intentionally empty.
        const res = await postJsonWithAuthRetry<{
          sessionId: string;
          userToken: string;
          encryptionKey: string;
          challengeId?: string;
        }>(endpoint, {});

        bindSession(res);

        if (needsChallenge && res.challengeId) {
          try {
            await executeChallenge({
              userToken: res.userToken,
              encryptionKey: res.encryptionKey,
              challengeId: res.challengeId,
            });
          } catch (challengeErr) {
            // A challenge sub-step (e.g. the security-question hint) can
            // fail even though the wallet/PIN it was securing was already
            // created — don't give up here, let loadWallet's retry confirm
            // one way or the other. Record the reason in case it wasn't.
            setError(humanize(challengeErr).title);
          }
        }

        await loadWallet(res.userToken, needsChallenge ? WALLET_INDEX_RETRIES : 0);
        // The borrow dashboard's own queries (market/loans) may have started
        // — and failed — the moment bindSession made sessionId truthy, well
        // before the PIN challenge above resolved. Kick them now that the
        // wallet is actually ready instead of waiting on their refetch interval.
        void queryClient.invalidateQueries({ queryKey: ["borrow"] });
      } catch (err) {
        setError(humanize(err).title);
      } finally {
        setIsBusy(false);
      }
    },
    [bindSession, loadWallet, queryClient],
  );

  const createWallet = useCallback(() => runAuthFlow("/api/pin/setup", true), [runAuthFlow]);
  const continueWithPin = useCallback(() => runAuthFlow("/api/pin/token", false), [runAuthFlow]);
  const resetPin = useCallback(() => runAuthFlow("/api/pin/reset", true), [runAuthFlow]);
  const recoverPin = useCallback(() => runAuthFlow("/api/pin/recover", true), [runAuthFlow]);

  const refreshWallet = useCallback(async () => {
    if (!session) return;
    await loadWallet(session.userToken);
  }, [session, loadWallet]);

  const withApproval = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    approvalRef.current = controller;
    try {
      return await request(controller.signal);
    } finally {
      if (approvalRef.current === controller) approvalRef.current = undefined;
    }
  }, []);

  // Sign-out follows right after, and its "signed-out" pass re-arms auto-resume and
  // auto-create. Re-arming them here, while still signed in, made the effect below resume
  // the old user mid sign-out, and its late answer then blocked wallet creation for the
  // next user to sign up in this tab.
  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = undefined;
    sessionRef.current = undefined;
    approvalRef.current?.abort();
    setSession(undefined);
    setWallet(undefined);
    setBalances([]);
    setSseReady(false);
    setNeedsWalletSetup(false);
  }, []);

  // Once a Supabase session exists, silently try to resume the Circle wallet
  // session instead of making the user re-enter anything. Falls back to
  // `needsWalletSetup` only if this Supabase user has no wallet yet.
  useEffect(() => {
    void (async () => {
      if (authStatus === "signed-out") {
        autoResumeAttempted.current = false;
        autoCreateAttempted.current = false;
        setNeedsWalletSetup(false);
        return;
      }
      if (authStatus !== "signed-in" || !user || session || autoResumeAttempted.current) return;
      autoResumeAttempted.current = true;
      const userId = user.id;

      setIsBusy(true);
      try {
        const { hasWallet } = await getJsonWithAuthRetry<{ hasWallet: boolean }>(
          "/api/wallet-accounts/me",
        );
        // Signed out (or in as someone else) while this was in flight: not our answer.
        if (userIdRef.current !== userId) return;
        if (hasWallet) {
          await continueWithPin();
        } else {
          setNeedsWalletSetup(true);
        }
      } catch (err) {
        if (userIdRef.current === userId) setError(humanize(err).title);
      } finally {
        setIsBusy(false);
      }
    })();
  }, [authStatus, user, session, continueWithPin]);

  // A brand-new user (no wallet yet) shouldn't have to click a button to
  // kick off wallet creation — start it as soon as we know they need it.
  // Guarded so a failed attempt doesn't retry-loop; the wallet-setup screen
  // offers its own manual retry if this doesn't pan out.
  useEffect(() => {
    if (!needsWalletSetup || session || autoCreateAttempted.current) return;
    autoCreateAttempted.current = true;
    void createWallet();
  }, [needsWalletSetup, session, createWallet]);

  return (
    <UcwSessionContext.Provider
      value={{
        session,
        wallet,
        balances,
        sseReady,
        isBusy,
        error,
        needsWalletSetup,
        createWallet,
        continueWithPin,
        resetPin,
        recoverPin,
        refreshWallet,
        withApproval,
        disconnect,
      }}
    >
      {children}
    </UcwSessionContext.Provider>
  );
}
