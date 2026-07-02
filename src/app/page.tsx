"use client";

import { api } from "../../convex/_generated/api";
import { SignIn } from "@/components/auth/sign-in";
import { ChatApp } from "@/components/chat/chat-app";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.currentUser, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ash" />
      </main>
    );
  }

  if (!isAuthenticated || me === null || me === undefined) {
    return <SignIn />;
  }

  return <ChatApp me={me} />;
}
