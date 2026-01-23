"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Security State
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [captchaQuestion, setCaptchaQuestion] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState<number | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = supabaseClient();
  
  const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes to reset count if inactive
  const CAPTCHA_AFTER = 3; // Show captcha after 3 failures
  const LOCKOUT_AFTER = 5; // Lock account after 5 failures
  const LOCKOUT_MS = 5 * 60 * 1000; // Lock for 5 minutes
  const STORAGE_KEY = "nyayagpt:login-attempts";

  const generateCaptcha = () => {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    setCaptchaQuestion(`${a} + ${b}`);
    setCaptchaAnswer(a + b);
  };

  const loadAttempts = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Reset if window expired
      if (parsed?.lastAttemptAt && Date.now() - parsed.lastAttemptAt > ATTEMPT_WINDOW_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (parsed?.count) setFailedAttempts(parsed.count);
      if (parsed?.lockedUntil) setLockedUntil(parsed.lockedUntil);
    } catch { /* ignore */ }
  };

  const persistAttempts = (count: number, lockUntil?: number | null) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 
        count, 
        lastAttemptAt: Date.now(), 
        lockedUntil: lockUntil || null 
      }));
    } catch { /* ignore */ }
  };

  useEffect(() => { loadAttempts(); }, []);

  useEffect(() => {
    if (searchParams.get("unverified")) setInfo("Please confirm your email address before logging in.");
    if (searchParams.get("reauth")) setInfo("Session expired. Please log in again.");
  }, [searchParams]);

  useEffect(() => {
    if (failedAttempts >= CAPTCHA_AFTER && !captchaQuestion) generateCaptcha();
  }, [failedAttempts, captchaQuestion]);

  useEffect(() => {
    if (lockedUntil && Date.now() > lockedUntil) {
      setLockedUntil(null);
      setFailedAttempts(0);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [lockedUntil]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check Lockout
    if (lockedUntil && Date.now() < lockedUntil) {
      setError(`Too many attempts. Please wait ${Math.ceil((lockedUntil - Date.now()) / 60000)} minutes.`);
      return;
    }
    
    setLoading(true);
    setError(null);
    setInfo(null);
    setShowResend(false);

    // Verify Captcha
    if (failedAttempts >= CAPTCHA_AFTER) {
      if (Number(captchaInput.trim()) !== captchaAnswer) {
        setError("Captcha incorrect. Please try again.");
        setLoading(false);
        generateCaptcha();
        return;
      }
    }

    // FIX: Normalize email to lowercase
    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      
      if (nextAttempts >= LOCKOUT_AFTER) {
        const lockUntil = Date.now() + LOCKOUT_MS;
        setLockedUntil(lockUntil);
        persistAttempts(nextAttempts, lockUntil);
        setError("Account locked temporarily due to too many failed attempts.");
      } else {
        persistAttempts(nextAttempts, lockedUntil);
        setError(error.message);
      }
      
      if (error.message.toLowerCase().includes("email not confirmed")) {
        setShowResend(true);
      }
      setLoading(false);
    } else {
      // Check Email Confirmation Status
      const user = data?.user;
      if (!user?.email_confirmed_at) {
        await supabase.auth.signOut();
        setShowResend(true);
        setInfo("Please confirm your email address before logging in.");
        setLoading(false);
        return;
      }
      
      // Success Cleanup
      setFailedAttempts(0);
      setLockedUntil(null);
      localStorage.removeItem(STORAGE_KEY);
      router.push("/dashboard");
      router.refresh();
    }
  };

  const handleResend = async () => {
    if (!email) { setError("Enter email first."); return; }
    setResendLoading(true);
    
    const { error } = await supabase.auth.resend({ 
      type: "signup", 
      email: email.trim().toLowerCase() 
    });
    
    if (error) {
      setError(error.message);
    } else {
        setInfo("Confirmation email sent. Check your inbox.");
        setShowResend(false);
    }
    setResendLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f14] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl animate-in fade-in zoom-in-95 duration-300">
        <h2 className="mb-6 text-center text-2xl font-semibold text-white">Welcome Back</h2>
        
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300 border border-emerald-500/20">
            {info}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Email</label>
            <input 
              type="email" 
              required 
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-white focus:border-primary focus:outline-none transition-colors placeholder-muted/50" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="you@example.com" 
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Password</label>
            <input 
              type="password" 
              required 
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-white focus:border-primary focus:outline-none transition-colors placeholder-muted/50" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="••••••••" 
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
          
          {failedAttempts >= CAPTCHA_AFTER && (
            <div className="rounded-lg border border-border bg-background px-3 py-2 animate-in fade-in">
              <label className="mb-1 block text-xs text-muted">Security Check: What is {captchaQuestion}?</label>
              <input 
                type="text" 
                value={captchaInput} 
                onChange={(e) => setCaptchaInput(e.target.value)} 
                className="w-full rounded bg-transparent text-white focus:outline-none text-sm" 
                required 
                placeholder="Answer" 
              />
            </div>
          )}
          
          {showResend && (
            <button 
              type="button" 
              onClick={handleResend} 
              disabled={resendLoading} 
              className="w-full text-xs text-muted hover:text-white transition-colors underline underline-offset-4"
            >
              {resendLoading ? "Sending..." : "Resend confirmation email"}
            </button>
          )}
        </form>
        
        <p className="mt-6 text-center text-sm text-muted">
          Don't have an account? <Link href="/signup" className="text-white hover:underline transition-colors font-medium">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
