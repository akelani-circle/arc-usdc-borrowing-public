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
import { KitError } from "@circle-fin/borrow-kit";
import { errorStatus, serializeError } from "@/lib/kitErrorTypes";

describe("serializeError", () => {
  it("pulls code/name/type/recoverability off a real KitError", () => {
    const kitError = new KitError({
      name: "INPUT_VALIDATION_FAILED",
      message: "the Circle user has not completed wallet setup yet",
      code: 1098,
      type: "INPUT",
      recoverability: "FATAL",
    });
    expect(serializeError(kitError)).toEqual({
      message: "the Circle user has not completed wallet setup yet",
      code: 1098,
      name: "INPUT_VALIDATION_FAILED",
      type: "INPUT",
      recoverability: "FATAL",
    });
  });

  it("does not mistake a plain error-shaped object for a KitError", () => {
    const plainObject = {
      name: "INPUT_VALIDATION_FAILED",
      message: "looks like a KitError but isn't branded",
      code: 1098,
      type: "INPUT",
      recoverability: "FATAL",
    };
    // Only the numeric code survives: the Circle wallets SDK's errors carry one too.
    expect(serializeError(plainObject)).toEqual({ message: "[object Object]", code: 1098 });
  });

  it("falls back to .message for a plain Error", () => {
    expect(serializeError(new Error("boom"))).toEqual({ message: "boom" });
  });

  it("stringifies anything else rather than losing it", () => {
    expect(serializeError("just a string")).toEqual({ message: "just a string" });
  });
});

describe("errorStatus", () => {
  const kit = (code: number, type: string) =>
    new KitError({ name: "TEST_ERROR", message: "test", code, type: type as never, recoverability: "FATAL" });

  // Every SDK failure used to come back as a 500.
  it.each([
    [1200, "INPUT", 404],
    [1202, "INPUT", 403],
    [1214, "INPUT", 409],
    [1211, "INPUT", 422],
    [1098, "INPUT", 400],
    [1099, "INPUT", 400],
    [9001, "BALANCE", 422],
    [5001, "ONCHAIN", 422],
    [7001, "RATE_LIMIT", 429],
    [3001, "NETWORK", 502],
    [3002, "NETWORK", 504],
    [8200, "SERVICE", 502],
    [8204, "SERVICE", 503],
    [0, "UNKNOWN", 500],
  ])("maps KitError %i (%s) to %i", (code, type, status) => {
    expect(errorStatus(kit(code, type))).toBe(status);
  });

  it("keeps a Circle API client error's status", () => {
    expect(errorStatus(Object.assign(new Error("already initialized"), { code: 155106, status: 409 }))).toBe(409);
    expect(errorStatus(Object.assign(new Error("bad request"), { status: 400 }))).toBe(400);
  });

  it("reports Circle rejecting the app's own credentials, or failing, as a bad gateway", () => {
    expect(errorStatus(Object.assign(new Error("unauthorized"), { status: 401 }))).toBe(502);
    expect(errorStatus(Object.assign(new Error("forbidden"), { status: 403 }))).toBe(502);
    expect(errorStatus(Object.assign(new Error("down"), { status: 503 }))).toBe(502);
  });

  it("falls back to 500 for anything else", () => {
    expect(errorStatus(new Error("boom"))).toBe(500);
    expect(errorStatus("boom")).toBe(500);
    expect(errorStatus(null)).toBe(500);
  });
});
