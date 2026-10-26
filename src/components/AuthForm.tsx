"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AuthFormProps {
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup ? { name, email, password, workspaceName } : { email, password },
        ),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/app");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white">
            CR
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">ColdReach</span>
        </div>
        <div className="card p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {isSignup ? "Create your workspace" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isSignup
              ? "Set up your account and your first workspace in one step."
              : "Sign in to your ColdReach workspace."}
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {isSignup && (
              <div>
                <label className="label" htmlFor="name">
                  Your name
                </label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={isSignup ? 10 : undefined}
                required
              />
              {isSignup && (
                <p className="mt-1 text-xs text-muted">At least 10 characters.</p>
              )}
            </div>
            {isSignup && (
              <div>
                <label className="label" htmlFor="workspace">
                  Workspace name <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="workspace"
                  className="input"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Your company or team"
                />
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
              {submitting
                ? isSignup
                  ? "Creating workspace"
                  : "Signing in"
                : isSignup
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New to ColdReach?{" "}
              <Link href="/signup" className="font-medium text-accent hover:underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
