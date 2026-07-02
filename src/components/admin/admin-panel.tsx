"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatListTimestamp } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowLeft, Flag, Loader2, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Admin panel (spec Sections 2, 5, 7): user table with search + ban/suspend/
 * warn, report list with detail + resolve. Metadata only — message content is
 * never available here (the backend enforces this; admin.ts cannot query
 * messages).
 */
export function AdminPanel() {
  const [tab, setTab] = useState<"users" | "reports">("users");
  return (
    <main className="relative z-10 mx-auto min-h-dvh max-w-5xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Back to chat">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold">Admin</h1>
            <p className="text-xs text-ash">
              Moderation metadata only — message content is never visible here.
            </p>
          </div>
        </div>
        <nav className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          <button
            onClick={() => setTab("users")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm cursor-pointer",
              tab === "users" ? "bg-moss text-paper" : "text-ash hover:text-fg",
            )}
          >
            <Users className="h-4 w-4" /> Users
          </button>
          <button
            onClick={() => setTab("reports")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm cursor-pointer",
              tab === "reports" ? "bg-moss text-paper" : "text-ash hover:text-fg",
            )}
          >
            <Flag className="h-4 w-4" /> Reports
          </button>
        </nav>
      </header>

      {tab === "users" ? <UsersTab /> : <ReportsTab />}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge>active</Badge>;
  if (status === "banned") return <Badge variant="danger">banned</Badge>;
  return <Badge variant="muted">suspended</Badge>;
}

function UserActions({
  userId,
  status,
  onError,
}: {
  userId: Id<"users">;
  status: string;
  onError: (msg: string) => void;
}) {
  const ban = useMutation(api.admin.banUser);
  const suspend = useMutation(api.admin.suspendUser);
  const warn = useMutation(api.admin.warnUser);
  const reinstate = useMutation(api.admin.reinstateUser);
  const [warned, setWarned] = useState(false);

  const run = (fn: () => Promise<unknown>) => () =>
    void fn().catch((err) =>
      onError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Action failed",
      ),
    );

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "active" ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={run(async () => {
              await warn({ userId });
              setWarned(true);
            })}
          >
            {warned ? "Warned" : "Warn"}
          </Button>
          <Button variant="outline" size="sm" onClick={run(() => suspend({ userId }))}>
            Suspend
          </Button>
          <Button variant="destructive" size="sm" onClick={run(() => ban({ userId }))}>
            Ban
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={run(() => reinstate({ userId }))}>
          Reinstate
        </Button>
      )}
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const users = useQuery(api.admin.listUsers, {
    filter: debounced || undefined,
  });

  return (
    <section>
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search usernames…"
          className="pl-9"
        />
      </div>
      {error && <p className="mb-3 text-sm text-clay">{error}</p>}

      {users === undefined ? (
        <Loader2 className="h-5 w-5 animate-spin text-ash" />
      ) : users.length === 0 ? (
        <p className="text-sm text-ash">No users match.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs text-ash">
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Last active</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-display font-semibold">
                    {u.username}
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "admin" ? (
                      <Badge variant="accent">admin</Badge>
                    ) : (
                      <span className="text-ash">user</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-ash">
                    {formatListTimestamp(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-ash">
                    {u.lastActiveAt ? formatListTimestamp(u.lastActiveAt) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.role !== "admin" && (
                      <UserActions
                        userId={u._id}
                        status={u.status}
                        onError={setError}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportsTab() {
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">(
    "open",
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reports = useQuery(api.reports.listReports, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const resolve = useMutation(api.reports.resolveReport);

  const filtered = (reports ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.reporter.toLowerCase().includes(q) ||
      r.reported.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      (r.messageSnapshot ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm">
          {(["open", "resolved", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-lg px-3 py-1.5 capitalize cursor-pointer",
                statusFilter === s
                  ? "bg-moss text-paper"
                  : "text-ash hover:text-fg",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="pl-9"
          />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-clay">{error}</p>}

      {reports === undefined ? (
        <Loader2 className="h-5 w-5 animate-spin text-ash" />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ash">No reports here — quiet day.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <li
              key={r._id}
              className="rounded-xl border border-line bg-surface/60 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-display font-semibold">
                    {r.reporter}
                  </span>{" "}
                  <span className="text-ash">reported</span>{" "}
                  <span className="font-display font-semibold">
                    {r.reported}
                  </span>{" "}
                  {r.reportedStatus && r.reportedStatus !== "active" && (
                    <StatusBadge status={r.reportedStatus} />
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ash">
                    {formatListTimestamp(r.createdAt)}
                  </span>
                  {r.status === "open" ? (
                    <Badge variant="accent">open</Badge>
                  ) : (
                    <Badge variant="muted">resolved</Badge>
                  )}
                </div>
              </div>

              <p className="mt-2 text-sm">{r.reason}</p>

              {r.messageSnapshot && (
                <div className="mt-2 rounded-lg border border-line bg-bg p-3">
                  <p className="mb-1 text-[11px] font-medium text-ash">
                    Message snapshot (voluntarily shared by the reporter):
                  </p>
                  <p className="text-xs">{r.messageSnapshot}</p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                {r.reportedStatus === "active" && (
                  <UserActions
                    userId={r.reportedUserId}
                    status="active"
                    onError={setError}
                  />
                )}
                {r.status === "open" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void resolve({ reportId: r._id }).catch(() =>
                        setError("Could not resolve the report"),
                      )
                    }
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
