"use client";

import { api } from "../../../convex/_generated/api";
import { AdminPanel } from "@/components/admin/admin-panel";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function AdminPage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.currentUser, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ash" />
      </main>
    );
  }

  if (!isAuthenticated || !me || me.role !== "admin") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="font-display text-lg">Admins only.</p>
        <Link href="/" className="text-sm text-clay underline">
          Back to chat
        </Link>
      </main>
    );
  }

  return <AdminPanel />;
}
