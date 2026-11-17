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

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { QuickAmounts } from "./QuickAmounts";
import { ActionStatus } from "./ActionStatus";
import { postJson } from "@/lib/api";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useUcwSession } from "@/contexts/UcwSessionContext";
import { logEvent } from "@/lib/activityLog";

// USDC amounts. These used to be cirBTC-sized (0.00005 to 0.0005), useless for a USDC loan.
const AMOUNT_PRESETS = ["0.5", "1", "5", "10"];

export function LoanPanel({
  activeLoanId,
  onSuccess,
}: {
  activeLoanId: string | undefined;
  onSuccess: () => void;
}) {
  const { session, withApproval } = useUcwSession();
  const [borrowAmount, setBorrowAmount] = useState("1");
  const [repayAmount, setRepayAmount] = useState("0.1");
  const [targetHealthFactor, setTargetHealthFactor] = useState("2");

  const collateralCheck = useAsyncAction<unknown>("Required collateral quote");
  const borrowQuote = useAsyncAction<unknown>("Borrow quote");
  const borrowExec = useAsyncAction<unknown>("Borrow");
  const repayQuote = useAsyncAction<unknown>("Repay quote");
  const repayExec = useAsyncAction<unknown>("Repay");
  const closeQuote = useAsyncAction<unknown>("Close loan quote");
  const closeExec = useAsyncAction<unknown>("Close loan");

  const hasLoan = !!activeLoanId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Loan
          <Badge variant="secondary">USDC</Badge>
          {hasLoan && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Active</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="borrow">
          <TabsList className="w-full">
            <TabsTrigger value="borrow" className="flex-1">Borrow</TabsTrigger>
            <TabsTrigger value="repay" className="flex-1">Repay</TabsTrigger>
          </TabsList>

          <TabsContent value="borrow" className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Amount (USDC)</p>
              <Input
                type="number"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                className="font-mono"
              />
              <QuickAmounts onSelect={setBorrowAmount} max={Infinity} presets={AMOUNT_PRESETS} />
            </div>

            {!hasLoan && (
              <>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Target health factor</p>
                    <Input
                      type="number"
                      value={targetHealthFactor}
                      onChange={(e) => setTargetHealthFactor(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={collateralCheck.isLoading || !borrowAmount}
                    onClick={() =>
                      collateralCheck.run(() =>
                        postJson("/api/borrow/required-collateral-quote", {
                          amount: borrowAmount,
                          targetHealthFactor,
                        }),
                      )
                    }
                  >
                    {collateralCheck.isLoading ? "Checking…" : "Check collateral"}
                  </Button>
                </div>
                <ActionStatus
                  {...collateralCheck}
                  loadingLabel="Checking required collateral…"
                  successLabel="See Activity log for the required collateral amount."
                />
              </>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="outline"
                disabled={borrowQuote.isLoading || !session || !borrowAmount}
                onClick={() =>
                  borrowQuote.run(() =>
                    postJson("/api/borrow/borrow-quote", {
                      sessionId: session?.sessionId,
                      amount: borrowAmount,
                      loanId: activeLoanId,
                    }),
                  )
                }
              >
                {borrowQuote.isLoading ? "Quoting…" : "Quote"}
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={!borrowQuote.isSuccess || borrowExec.isLoading}
                onClick={async () => {
                  const result = await borrowExec.run(() =>
                    withApproval((signal) =>
                      postJson(
                        "/api/borrow/borrow",
                        { sessionId: session?.sessionId, amount: borrowAmount, loanId: activeLoanId },
                        signal,
                      ),
                    ),
                  );
                  if (result) {
                    borrowQuote.reset();
                    onSuccess();
                  }
                }}
              >
                {borrowExec.isLoading ? "Approve the PIN challenge…" : hasLoan ? "Borrow more USDC" : "Open loan"}
              </Button>
            </div>
            <ActionStatus {...borrowQuote} loadingLabel="Fetching quote…" successLabel="Quote ready — see Activity log." />
            <ActionStatus {...borrowExec} loadingLabel="Waiting for PIN approval…" successLabel="Borrow complete." />
          </TabsContent>

          <TabsContent value="repay" className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Amount (USDC)</p>
              <Input
                type="number"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                className="font-mono"
                disabled={!hasLoan}
              />
              <QuickAmounts onSelect={setRepayAmount} max={hasLoan ? Infinity : 0} presets={AMOUNT_PRESETS} />
            </div>
            {!hasLoan ? (
              <p className="text-xs text-muted-foreground text-center py-2">No active loan to repay.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant="outline"
                    disabled={repayQuote.isLoading || !repayAmount}
                    onClick={() =>
                      repayQuote.run(() => postJson("/api/borrow/repay-quote", { loanId: activeLoanId, amount: repayAmount }))
                    }
                  >
                    {repayQuote.isLoading ? "Quoting…" : "Quote"}
                  </Button>
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={!repayQuote.isSuccess || repayExec.isLoading}
                    onClick={async () => {
                      const result = await repayExec.run(() =>
                        withApproval((signal) =>
                          postJson(
                            "/api/borrow/repay",
                            { sessionId: session?.sessionId, loanId: activeLoanId, amount: repayAmount },
                            signal,
                          ),
                        ),
                      );
                      if (result) {
                        repayQuote.reset();
                        onSuccess();
                      }
                    }}
                  >
                    {repayExec.isLoading ? "Approve the PIN challenge…" : "Repay USDC"}
                  </Button>
                </div>
                <ActionStatus {...repayQuote} loadingLabel="Fetching quote…" successLabel="Quote ready — see Activity log." />
                <ActionStatus {...repayExec} loadingLabel="Waiting for PIN approval…" successLabel="Repay complete." />
              </>
            )}
          </TabsContent>
        </Tabs>

        {hasLoan && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Repay everything and return your collateral in one call.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={closeQuote.isLoading}
                  onClick={() => closeQuote.run(() => postJson("/api/borrow/close-quote", { loanId: activeLoanId }))}
                >
                  {closeQuote.isLoading ? "Quoting…" : "Quote close"}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={!closeQuote.isSuccess || closeExec.isLoading}
                  onClick={async () => {
                    const result = await closeExec.run(() =>
                      withApproval((signal) =>
                        postJson("/api/borrow/close", { sessionId: session?.sessionId, loanId: activeLoanId }, signal),
                      ),
                    );
                    if (result) {
                      closeQuote.reset();
                      logEvent("Loan closed", result);
                      onSuccess();
                    }
                  }}
                >
                  {closeExec.isLoading ? "Approve the PIN challenge…" : "Close loan"}
                </Button>
              </div>
              <ActionStatus {...closeQuote} loadingLabel="Fetching close quote…" successLabel="Quote ready — see Activity log." />
              <ActionStatus {...closeExec} loadingLabel="Waiting for PIN approval…" successLabel="Loan closed — collateral returned." />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
