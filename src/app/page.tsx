"use client";

import { api } from "../../convex/_generated/api";
import { SetupProfile, SignIn } from "@/components/auth/sign-in";
import { ChatApp } from "@/components/chat/chat-app";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const me = useQuery(api.users.currentUser, isSignedIn ? {} : "skip");

  if (!clerkLoaded || (isSignedIn && me === undefined)) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ash" />
      </main>
    );
  }

  if (!isSignedIn) {
    return <SignIn />;
  }

  if (me === null || me === undefined) {
    return <SetupProfile />;
  }

  return <ChatApp me={me} />;
}
