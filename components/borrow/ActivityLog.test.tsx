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
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { insert, single } = vi.hoisted(() => ({ insert: vi.fn(), single: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({ from: () => ({ insert }) }),
}));

// What Supabase resolves with when the request never reaches it. It never rejects.
const networkDown = { data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" } };

vi.mock("@/lib/useActivityLogSync", () => ({ useActivityLogSync: vi.fn() }));

import { ActivityLog } from "@/components/borrow/ActivityLog";
import { logEvent } from "@/lib/activityLog";

beforeEach(() => {
  insert.mockReset();
  insert.mockImplementation(() => ({ select: () => ({ single }) }));
  single.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ActivityLog", () => {
  it("shows a failed write as not saved and retries it on request", async () => {
    single.mockResolvedValue(networkDown);
    render(<ActivityLog />);

    act(() => logEvent("Borrow", { amount: 1 }));

    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(screen.getByText("TypeError: Failed to fetch")).toBeInTheDocument();
    expect(
      screen.getByText(/failed to save to your account and will be lost/i),
    ).toBeInTheDocument();

    single.mockResolvedValue({ data: { id: 1 }, error: null });
    await userEvent.click(screen.getByRole("button", { name: /retry saving$/i }));

    await waitFor(() => expect(screen.queryByText("Not saved")).not.toBeInTheDocument());
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("keeps the failed entry visible instead of dropping it", async () => {
    single.mockResolvedValue(networkDown);
    render(<ActivityLog />);

    act(() => logEvent("Borrow quote", { amount: 1 }));

    expect(await screen.findByText("Borrow quote")).toBeInTheDocument();
  });
});
