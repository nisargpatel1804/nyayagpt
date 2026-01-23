"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabaseClient";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const router = useRouter();
  const supabase = supabaseClient();

  // Robust Password Validation
  // Requires: 8+ chars, Uppercase, Lowercase, Number, and Special Char
  const isStrongPassword = (value: string) => {
    return (
      value.length >= 8 &&
      /[A-Z]/.test(value) && // Uppercase
      /[a-z]/.test(value) && // Lowercase
      /\d/.test(value) &&    // Number
      /[!@#$%^&*(),.?":{}|<>]/.test(value) // Explicit special chars (safer than ^A-Za-z0-9)
    );
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    // 1. Validate Password Strength
    if (!isStrongPassword(password)) {
      setError(
        "Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character (!@#$%^&*)."
      );
      setLoading(false);
      return;
    }

    // 2. Normalize Email (Prevent case-sensitivity issues)
    const cleanEmail = email.trim().toLowerCase();

    // 3. Attempt Signup
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${location.origin}/dashboard`,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      // Check if session was created immediately (rare, depends on Supabase config)
      // or if email confirmation is required (standard).
      if (data?.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setInfo("Account created successfully! Please check your email to confirm your account before logging in.");
        // Clear sensitive fields
        setPassword(""); 
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f14] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold text-white">Create Account</h2>
          <p className="mt-2 text-sm text-muted">Join NyayaGPT for legal assistance</p>
        </div>
        
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {info}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-white placeholder-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Password</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-white placeholder-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <p className="mt-1.5 text-[10px] text-muted/70">
              Must contain 8+ chars, uppercase, lowercase, number & symbol.
            </p>
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white"></span>
                Creating account...
              </span>
            ) : (
              "Sign Up"
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-muted">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:text-primary/80 hover:underline transition-colors font-medium">
              Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}