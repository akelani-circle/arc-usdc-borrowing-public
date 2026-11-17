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

import { Fragment, useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { JsonHighlight } from "./JsonHighlight";
import { useActivityLog, clearLog, retryPersistence, retryFailedEntries, type LogEntry } from "@/lib/activityLog";
import { useActivityLogSync } from "@/lib/useActivityLogSync";
import { summarizeEntry, type ActivityStatus, type ActivityChip } from "@/lib/activitySummary";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<ActivityStatus, string> = {
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  pending: "bg-sky-500",
  error: "bg-destructive",
};

const VALUE_TONE: Record<ActivityStatus, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  pending: "text-sky-600 dark:text-sky-400",
  error: "text-destructive",
};

function Field({ chip }: { chip: ActivityChip }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
      <span className="text-muted-foreground">{chip.label}</span>
      <span className={cn("font-medium tabular-nums", chip.tone && VALUE_TONE[chip.tone])}>
        {chip.value}
      </span>
    </span>
  );
}

function EntryRow({ entry }: { entry: LogEntry }) {
  const [showRaw, setShowRaw] = useState(false);
  const summary = summarizeEntry(entry.label, entry.data);
  const label = entry.label.replace(/\s*—\s*error$/, "");
  const unsaved = entry.persistence === "failed";

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[summary.status])}
            title={summary.status}
          />
          <p className="truncate text-xs font-medium">{label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entry.persistence === "pending" && (
            <span className="text-[11px] text-muted-foreground">Saving…</span>
          )}
          {unsaved && <span className="text-[11px] text-destructive">Not saved</span>}
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {summary.headline && <p className="mt-1 pl-4 text-xs text-muted-foreground">{summary.headline}</p>}

      {summary.chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-4">
          {summary.chips.map((chip, i) => (
            <Fragment key={i}>
              {i > 0 && <Separator orientation="vertical" className="h-3.5" />}
              <Field chip={chip} />
            </Fragment>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-3 pl-4">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {showRaw ? "Hide raw response" : "View raw response"}
        </button>
        {unsaved && (
          <button
            type="button"
            onClick={() => retryPersistence(entry.id)}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Retry saving this call
          </button>
        )}
      </div>

      {unsaved && entry.persistenceError && (
        <p className="mt-1 pl-4 text-[11px] text-destructive break-all">{entry.persistenceError}</p>
      )}

      {showRaw && (
        <pre className="mt-1.5 ml-4 max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
          <JsonHighlight value={entry.data} />
        </pre>
      )}
    </div>
  );
}

export function ActivityLog() {
  useActivityLogSync();
  const entries = useActivityLog();
  const unsavedCount = entries.filter((entry) => entry.persistence === "failed").length;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">
          Activity log
          {entries.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {entries.length} call{entries.length === 1 ? "" : "s"}
            </span>
          )}
        </CardTitle>
        <CardAction className="row-span-1 self-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-1"
            aria-label="Clear activity log"
            onClick={clearLog}
            disabled={entries.length === 0}
          >
            <Trash2 className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {unsavedCount > 0 && (
          <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <p className="text-xs text-destructive">
              {unsavedCount} call{unsavedCount === 1 ? "" : "s"} failed to save to your account and
              will be lost when this page reloads.
            </p>
            <button
              type="button"
              onClick={retryFailedEntries}
              className="mt-1 text-[11px] text-destructive underline underline-offset-2"
            >
              Retry saving
            </button>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Raw Borrow Kit responses will show up here as you use the app.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-auto">
            {[...entries].reverse().map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
