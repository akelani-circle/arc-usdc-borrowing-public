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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarketInfo, ListLoansResult } from "@circle-fin/borrow-kit";
import { ApiError, postJson } from "@/lib/api";
import { useUcwSession } from "@/contexts/UcwSessionContext";

const REFETCH_INTERVAL = 15_000;

// Retry only what can succeed on a second try: network failures, 5xx answers and errors the
// SDK flags as retryable. A 4xx (bad input, unknown loan) fails the same way every time.
const MAX_RETRIES = 3;

function isRetryable(error: Error) {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || error.recoverability === "RETRYABLE" || error.recoverability === "RESUMABLE";
}

// A loan action (open/borrow/repay/close) settles on-chain and then needs a
// moment before Borrow Kit's own indexing reflects it in getLoans — the same
// class of lag as WALLET_NOT_READY above. A single invalidate right after
// the action can win the race and show stale collateral/borrowed/health
// figures, so follow up a couple more times instead of waiting out the full
// refetchInterval.
const POST_ACTION_REFETCH_DELAYS = [0, 2_000, 5_000];

export function useBorrowState() {
  const { session, wallet } = useUcwSession();
  const sessionId = session?.sessionId;
  const queryClient = useQueryClient();

  const marketQuery = useQuery({
    queryKey: ["borrow", "market"],
    queryFn: () => postJson<MarketInfo>("/api/borrow/market", {}),
    // The route needs a signed-in user, and the market is only shown on the dashboard.
    enabled: !!sessionId,
    refetchInterval: REFETCH_INTERVAL,
    retry: (failureCount, error) => isRetryable(error) && failureCount < MAX_RETRIES,
  });

  const loansQuery = useQuery({
    queryKey: ["borrow", "loans", sessionId],
    queryFn: () =>
      postJson<{ walletAddress: string } & ListLoansResult>("/api/borrow/loans", { sessionId }),
    // Wait for the wallet to actually be confirmed (loadWallet resolved a
    // listWallets hit) — sessionId alone goes true before the PIN challenge
    // finishes and the signing method is established server-side, which was
    // causing this query to fire and fail repeatedly right after sign-up.
    enabled: !!sessionId && !!wallet,
    refetchInterval: REFETCH_INTERVAL,
    retry: (failureCount, error) => isRetryable(error) && failureCount < MAX_RETRIES,
  });

  // Each Loan already carries collateral/borrowed/health/ltv/liquidationPrice —
  // no separate getPosition(loanId) call needed for the primary display.
  // getLoans also returns closed loans, so pick the open one: a closed loan
  // can't be repaid, closed or grown, and a new loan can only be opened once
  // none is active.
  const loans = loansQuery.data?.loans ?? [];
  const activeLoan = loans.find((loan) => loan.status === "active");

  function refetchAll() {
    for (const delay of POST_ACTION_REFETCH_DELAYS) {
      if (delay === 0) {
        void queryClient.invalidateQueries({ queryKey: ["borrow"] });
      } else {
        setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["borrow"] }), delay);
      }
    }
  }

  return {
    market: marketQuery.data,
    isMarketLoading: marketQuery.isLoading,
    loans,
    activeLoanId: activeLoan?.loanId,
    position: activeLoan,
    isLoansLoading: loansQuery.isLoading,
    refetchAll,
  };
}
