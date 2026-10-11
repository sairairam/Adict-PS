"use client";

import { useActionState } from "react";
import { signIn, signUp } from "./actions";

export default function LoginPage() {
  const [signInError, signInAction, signingIn] = useActionState(signIn, null);
  const [signUpError, signUpAction, signingUp] = useActionState(signUp, null);
  const error = signInError ?? signUpError;
  const busy = signingIn || signingUp;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className="rounded border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input name="password" type="password" required minLength={8} autoComplete="current-password" className="rounded border p-2" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button formAction={signInAction} disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
            Sign in
          </button>
          <button formAction={signUpAction} disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
