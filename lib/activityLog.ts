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

import { useSyncExternalStore } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Whether the entry reached the user's durable activity log in Supabase. */
export type PersistenceState = "pending" | "saved" | "failed";

export interface LogEntry {
  id: number;
  timestamp: number;
  label: string;
  data: unknown;
  persistence: PersistenceState;
  persistenceError?: string;
}

let entries: LogEntry[] = [];
// Entries made in this tab get negative ids until Supabase assigns the real one, so they can
// never clash with the ids of rows loaded from Supabase.
let nextLocalId = -1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function updateEntry(id: number, patch: Partial<LogEntry>) {
  entries = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  emit();
}

/** Appends a Borrow Kit call's raw response (or error) to the activity log panel. */
export function logEvent(label: string, data?: unknown) {
  const entry: LogEntry = {
    id: nextLocalId--,
    timestamp: Date.now(),
    label,
    data,
    persistence: "pending",
  };
  entries = [...entries, entry].slice(-50);
  emit();

  // RLS scopes this to the signed-in user. The outcome is tracked per entry so a failed
  // write shows up in the panel and can be retried, instead of only reaching the console.
  void persistEntry(entry);
}

/** Supabase returns errors as plain `{ message }` objects, not `Error` instances. */
function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return String(err);
}

async function persistEntry(entry: LogEntry) {
  try {
    const { data, error } = await getSupabaseBrowserClient()
      .from("activity_log")
      .insert({ label: entry.label, data: entry.data })
      .select("id")
      .single();
    if (error) throw error;
    markSaved(entry.id, data.id);
  } catch (err) {
    console.error("[activityLog] persist failed", err);
    updateEntry(entry.id, { persistence: "failed", persistenceError: errorMessage(err) });
  }
}

/** Swaps a local entry's id for its Supabase row id, or drops it if a reload already loaded that row. */
function markSaved(localId: number, remoteId: number) {
  if (entries.some((entry) => entry.id === remoteId)) {
    entries = entries.filter((entry) => entry.id !== localId);
    emit();
    return;
  }
  updateEntry(localId, { id: remoteId, persistence: "saved", persistenceError: undefined });
}

/** Retries persisting a single entry whose write failed. */
export function retryPersistence(id: number) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || entry.persistence !== "failed") return;
  updateEntry(entry.id, { persistence: "pending", persistenceError: undefined });
  void persistEntry(entry);
}

/** Retries persisting every entry whose write failed. */
export function retryFailedEntries() {
  for (const entry of entries) {
    if (entry.persistence !== "failed") continue;
    updateEntry(entry.id, { persistence: "pending", persistenceError: undefined });
    void persistEntry(entry);
  }
}

/**
 * Replaces the saved entries with rows fetched from Supabase (newest-first input, stored
 * oldest-first). Entries not saved yet only exist here, so they are kept.
 */
export function hydrateFromRemote(
  rows: { id: number; label: string; data: unknown; created_at: string }[],
) {
  const remote: LogEntry[] = rows.map((r) => ({
    id: r.id,
    timestamp: new Date(r.created_at).getTime(),
    label: r.label,
    data: r.data,
    persistence: "saved",
  }));
  const unsaved = entries.filter((entry) => entry.persistence !== "saved");
  entries = [...remote, ...unsaved].sort((a, b) => a.timestamp - b.timestamp).slice(-50);
  emit();
}

export function clearLog() {
  entries = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return entries;
}

export function useActivityLog() {
  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}
