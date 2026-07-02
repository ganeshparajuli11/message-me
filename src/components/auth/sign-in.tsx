"use client";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative z-10 flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Inkwell
          </h1>
          <p className="mt-2 text-sm text-ash">
            Private, one-to-one notes in real time.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}

export function SignIn() {
  return (
    <Shell>
      <div className="space-y-3 rounded-2xl border border-line bg-surface/60 p-6 shadow-sm">
        <SignInButton mode="modal">
          <Button variant="accent" className="w-full">
            Sign in
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button variant="outline" className="w-full">
            Create account
          </Button>
        </SignUpButton>
      </div>
    </Shell>
  );
}

export function SetupProfile() {
  const createCurrentUser = useMutation(api.users.createCurrentUser);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void createCurrentUser({}).catch((err) => {
      const msg =
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Could not create your profile";
      setError(msg);
    });
  }, [createCurrentUser]);

  return (
    <Shell>
      <div className="rounded-2xl border border-line bg-surface/60 p-6 text-center shadow-sm">
        {error === null ? (
          <>
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-ash" />
            <p className="mt-3 text-sm text-ash">Setting up your profile...</p>
          </>
        ) : (
          <p className="text-sm text-clay">{error}</p>
        )}
      </div>
    </Shell>
  );
}
