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
import { QuickAmounts } from "./QuickAmounts";
import { ActionStatus } from "./ActionStatus";
import { postJson } from "@/lib/api";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useUcwSession } from "@/contexts/UcwSessionContext";

const PRESETS = ["0.0001", "0.0002", "0.0005", "0.001"];

export function CollateralPanel({
  activeLoanId,
  onSuccess,
}: {
  activeLoanId: string | undefined;
  onSuccess: () => void;
}) {
  const { session, withApproval } = useUcwSession();
  const [addAmount, setAddAmount] = useState("0.00001");
  const [withdrawAmount, setWithdrawAmount] = useState("0.000001");

  const addQuote = useAsyncAction<unknown>("Add collateral quote");
  const addExec = useAsyncAction<unknown>("Add collateral");
  const withdrawQuote = useAsyncAction<unknown>("Withdraw collateral quote");
  const withdrawExec = useAsyncAction<unknown>("Withdraw collateral");

  const hasLoan = !!activeLoanId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Collateral
          <Badge variant="secondary">cirBTC</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {hasLoan
            ? "Add to or withdraw from your existing loan's collateral."
            : "Open a loan first (Borrow tab) — Borrow Kit supplies initial collateral automatically."}
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="add">
          <TabsList className="w-full">
            <TabsTrigger value="add" className="flex-1">Add</TabsTrigger>
            <TabsTrigger value="withdraw" className="flex-1">Withdraw</TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Amount (cirBTC)</p>
              <Input
                type="number"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                className="font-mono"
                disabled={!hasLoan}
              />
              <QuickAmounts onSelect={setAddAmount} max={hasLoan ? Infinity : 0} presets={PRESETS} />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="outline"
                disabled={!hasLoan || addQuote.isLoading || !addAmount}
                onClick={() =>
                  addQuote.run(() => postJson("/api/borrow/add-collateral-quote", { loanId: activeLoanId, amount: addAmount }))
                }
              >
                {addQuote.isLoading ? "Quoting…" : "Quote"}
              </Button>
              <Button
                className="flex-1"
                disabled={!hasLoan || !addQuote.isSuccess || addExec.isLoading || !addAmount}
                onClick={async () => {
                  const result = await addExec.run(() =>
                    withApproval((signal) =>
                      postJson(
                        "/api/borrow/add-collateral",
                        { sessionId: session?.sessionId, loanId: activeLoanId, amount: addAmount },
                        signal,
                      ),
                    ),
                  );
                  if (result) {
                    addQuote.reset();
                    onSuccess();
                  }
                }}
              >
                {addExec.isLoading ? "Approve the PIN challenge…" : "Add collateral"}
              </Button>
            </div>
            <ActionStatus {...addQuote} loadingLabel="Fetching quote…" successLabel="Quote ready — see Activity log." />
            <ActionStatus {...addExec} loadingLabel="Waiting for PIN approval…" successLabel="Collateral added." />
          </TabsContent>

          <TabsContent value="withdraw" className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Withdrawing collateral may also repay USDC to keep the loan healthy. Check the quote for the maximum repayment.
            </p>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Amount (cirBTC)</p>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="font-mono"
                disabled={!hasLoan}
              />
              <QuickAmounts onSelect={setWithdrawAmount} max={hasLoan ? Infinity : 0} presets={PRESETS} />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="outline"
                disabled={!hasLoan || withdrawQuote.isLoading || !withdrawAmount}
                onClick={() =>
                  withdrawQuote.run(() =>
                    postJson("/api/borrow/withdraw-collateral-quote", { loanId: activeLoanId, amount: withdrawAmount }),
                  )
                }
              >
                {withdrawQuote.isLoading ? "Quoting…" : "Quote"}
              </Button>
              <Button
                className="flex-1"
                disabled={!hasLoan || !withdrawQuote.isSuccess || withdrawExec.isLoading || !withdrawAmount}
                onClick={async () => {
                  const result = await withdrawExec.run(() =>
                    withApproval((signal) =>
                      postJson(
                        "/api/borrow/withdraw-collateral",
                        { sessionId: session?.sessionId, loanId: activeLoanId, amount: withdrawAmount },
                        signal,
                      ),
                    ),
                  );
                  if (result) {
                    withdrawQuote.reset();
                    onSuccess();
                  }
                }}
              >
                {withdrawExec.isLoading ? "Approve the PIN challenge…" : "Withdraw collateral"}
              </Button>
            </div>
            <ActionStatus {...withdrawQuote} loadingLabel="Fetching quote…" successLabel="Quote ready — see Activity log." />
            <ActionStatus {...withdrawExec} loadingLabel="Waiting for PIN approval…" successLabel="Collateral withdrawn." />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
