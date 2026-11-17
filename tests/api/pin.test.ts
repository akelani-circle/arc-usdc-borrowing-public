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

import { sessions } from "@/lib/session";

import { ALICE, BOB, post, signIn, ucwClient } from "../helpers/route-mocks";

const routes = ["token", "setup", "reset", "recover"] as const;

async function call(route: string) {
  const mod = await import(/* @vite-ignore */ `${process.cwd()}/app/api/pin/${route}/route.ts`);
  return mod.POST(post({ userId: "someone-else" }));
}

function circleReturnsCredentials() {
  ucwClient.createUser.mockResolvedValue({});
  ucwClient.createUserToken.mockResolvedValue({ data: { userToken: "user-token", encryptionKey: "enc-key" } });
  ucwClient.createUserPinWithWallets.mockResolvedValue({ data: { challengeId: "c1" } });
  ucwClient.updateUserPin.mockResolvedValue({ data: { challengeId: "c2" } });
  ucwClient.restoreUserPin.mockResolvedValue({ data: { challengeId: "c3" } });
}

describe.each(routes)("/api/pin/%s", (route) => {
  it("acts for the signed-in user, ignoring any user id in the body", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    const res = await call(route);
    expect(res.status).toBe(200);
    expect(ucwClient.createUserToken).toHaveBeenCalledWith({ userId: ALICE });
  });

  it("binds the new session to that user", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    const { sessionId } = await (await call(route)).json();
    expect(sessions.get(sessionId)).toMatchObject({ userId: ALICE, userToken: "user-token" });
  });

  it("does not mint a token for a signed-out caller", async () => {
    signIn(null);
    expect((await call(route)).status).toBe(401);
    expect(ucwClient.createUserToken).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
  });

  it("allows 10 calls a minute per user, then 429, without minting more tokens or sessions", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    for (let i = 0; i < 10; i++) expect((await call(route)).status).toBe(200);
    const res = await call(route);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(ucwClient.createUserToken).toHaveBeenCalledTimes(10);

    signIn(BOB);
    expect((await call(route)).status).toBe(200);
  });

  it("keeps at most five sessions per user however often it is called", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    for (let i = 0; i < 8; i++) await call(route);
    expect([...sessions.values()].filter((s) => s.userId === ALICE)).toHaveLength(5);
  });
});

describe("/api/pin/*: pool of limits", () => {
  it("shares one budget across the four routes", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    for (let i = 0; i < 10; i++) await call(routes[i % 4]);
    expect((await call("token")).status).toBe(429);
  });
});

describe("/api/pin/setup for a user Circle already set up", () => {
  const alreadyInitialized = () =>
    ucwClient.createUserPinWithWallets.mockRejectedValue(
      Object.assign(new Error("The user had already been initialized."), { code: 155106, status: 409 }),
    );

  // The app's wallet_accounts row can be missing for a user who already has a PIN and a
  // wallet. Setup answered 155106 as an error, and the setup screen retried it forever.
  it("returns a session without a challenge when the wallet already exists", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    alreadyInitialized();
    ucwClient.listWallets.mockResolvedValue({ data: { wallets: [{ id: "w1" }] } });

    const res = await call("setup");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challengeId).toBeUndefined();
    expect(sessions.get(body.sessionId)).toMatchObject({ userId: ALICE, userToken: "user-token" });
    expect(ucwClient.createWallet).not.toHaveBeenCalled();
  });

  it("creates just the wallet when the user has a PIN but no wallet", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    alreadyInitialized();
    ucwClient.listWallets.mockResolvedValue({ data: { wallets: [] } });
    ucwClient.createWallet.mockResolvedValue({ data: { challengeId: "c4" } });

    const body = await (await call("setup")).json();
    expect(body.challengeId).toBe("c4");
    expect(ucwClient.createWallet).toHaveBeenCalledWith({
      userToken: "user-token",
      accountType: "SCA",
      blockchains: ["ARC-TESTNET"],
    });
  });

  it("still reports other Circle errors, with Circle's status", async () => {
    signIn(ALICE);
    circleReturnsCredentials();
    ucwClient.createUserPinWithWallets.mockRejectedValue(
      Object.assign(new Error("The userToken had expired."), { code: 155104, status: 400 }),
    );

    const res = await call("setup");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The userToken had expired.", code: 155104 });
  });
});
