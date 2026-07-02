"use client";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Signup/sign-in screen (spec Sections 2, 7): username input with live
 * availability badge, deterministic suggestion chips, password, submit.
 */
export function SignIn() {
  const convex = useConvex();
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signUp" | "signIn">("signUp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [debounced, setDebounced] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(username.trim()), 300);
    return () => clearTimeout(t);
  }, [username]);

  const check = useQuery(
    api.users.checkUsernameAndSuggest,
    flow === "signUp" && debounced.length > 0 ? { username: debounced } : "skip",
  );
  const checking =
    flow === "signUp" && debounced.length > 0 && check === undefined;

  const canSubmit =
    !submitting &&
    password.length > 0 &&
    (flow === "signUp"
      ? name.trim().length > 0 &&
        email.trim().length > 0 &&
        username.trim().length > 0 &&
        check?.valid === true &&
        check.available === true
      : identifier.trim().length > 0);

  async function resolveAuthEmailFromIdentifier(rawIdentifier: string) {
    const normalized = rawIdentifier.trim().toLowerCase();
    if (normalized.length === 0) return null;
    if (normalized.includes("@")) return normalized;
    return await convex.query(api.users.resolveLoginEmail, {
      identifier: normalized,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (flow === "signUp") {
        await signIn("password", {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          username: username.trim(),
          password,
          flow,
        });
      } else {
        const normalizedIdentifier = identifier.trim();
        const authEmail = await resolveAuthEmailFromIdentifier(normalizedIdentifier);
        if (!authEmail) {
          throw new ConvexError("Wrong username/email or password");
        }
        const maybeUsername = normalizedIdentifier.includes("@")
          ? undefined
          : normalizedIdentifier;
        const signInPayload: Record<string, any> = {
          email: authEmail,
          password,
          flow,
        };
        if (maybeUsername) {
          signInPayload.username = maybeUsername;
        }
        await signIn("password", signInPayload);
      }
    } catch (err) {
      const msg =
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : flow === "signIn"
            ? "Wrong username/email or password"
            : "Could not create the account — try again";
      setError(msg);
      setSubmitting(false);
    }
  }

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

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-line bg-surface/60 p-6 shadow-sm"
        >
          {flow === "signUp" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                autoFocus
              />
            </div>
          )}

          {flow === "signUp" && (
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          )}

          {flow === "signIn" && (
            <div>
              <label
                htmlFor="identifier"
                className="mb-1.5 block text-sm font-medium"
              >
                Username or email
              </label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="quiet_wren or you@example.com"
                autoComplete="username"
                autoFocus
              />
            </div>
          )}

          {flow === "signUp" && (
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
                Username
              </label>
              <div className="relative">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. quiet_wren"
                  autoComplete="username"
                  maxLength={20}
                />
                {debounced.length > 0 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-ash" />
                    ) : check?.valid && check.available ? (
                      <Check className="h-4 w-4 text-moss" aria-label="available" />
                    ) : (
                      <X className="h-4 w-4 text-clay" aria-label="unavailable" />
                    )}
                  </span>
                )}
              </div>

              {check !== undefined && debounced.length > 0 && (
                <div className="mt-2 text-xs">
                  {!check.valid ? (
                    <p className="text-clay">{check.error}</p>
                  ) : check.available ? (
                    <p className="text-moss">@{debounced} is available</p>
                  ) : (
                    <>
                      <p className="text-clay">@{debounced} is taken — try:</p>
                      {check.suggestions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {check.suggestions.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setUsername(s)}
                              className="rounded-full border border-line bg-bg px-2.5 py-1 text-xs hover:border-moss hover:text-moss cursor-pointer"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={flow === "signUp" ? "At least 8 characters" : "Password"}
              autoComplete={flow === "signUp" ? "new-password" : "current-password"}
            />
          </div>

          {error && <p className="text-sm text-clay">{error}</p>}

          <Button
            type="submit"
            variant="accent"
            disabled={!canSubmit}
            className="w-full"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : flow === "signUp" ? (
              "Create account"
            ) : (
              "Sign in"
            )}
          </Button>

          <button
            type="button"
            onClick={() => {
              setFlow(flow === "signUp" ? "signIn" : "signUp");
              setError(null);
            }}
            className={cn(
              "w-full text-center text-xs text-ash hover:text-fg cursor-pointer",
            )}
          >
            {flow === "signUp"
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </form>
      </div>
    </main>
  );
}
