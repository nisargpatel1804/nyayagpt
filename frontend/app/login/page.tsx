"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = supabaseClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    setShowResend(false);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      if (error.message.toLowerCase().includes("email not confirmed")) {
        setShowResend(true);
      }
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError("Please enter your email above first.");
      return;
    }

    setResendLoading(true);
    setError(null);
    setInfo(null);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (error) {
      setError(error.message);
    } else {
      setInfo("Confirmation email sent. Please check your inbox.");
      setShowResend(false);
    }

    setResendLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f14] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <h2 className="mb-6 text-center text-2xl font-semibold text-white">Welcome Back</h2>
        
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {info}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-white placeholder-muted focus:border-primary focus:outline-none"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Password</label>
            <input
              type="password"
              required
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-white placeholder-muted focus:border-primary focus:outline-none"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
          {showResend && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading}
              className="w-full rounded-lg border border-border bg-transparent py-2.5 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
            >
              {resendLoading ? "Sending..." : "Resend confirmation email"}
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Don't have an account?{" "}
          <Link href="/signup" className="text-white hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}