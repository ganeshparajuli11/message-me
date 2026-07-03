"use client";

import { api } from "../../../convex/_generated/api";
import { AdminPanel } from "@/components/admin/admin-panel";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function AdminPage() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const me = useQuery(api.users.currentUser, isSignedIn ? {} : "skip");

  if (!clerkLoaded || (isSignedIn && me === undefined)) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ash" />
      </main>
    );
  }

  if (!isSignedIn || !me || me.role !== "admin") {
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
