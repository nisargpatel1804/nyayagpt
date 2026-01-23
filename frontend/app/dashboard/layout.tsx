import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  
  // Security Check 1: Email Verification
  if (!user?.email_confirmed_at) {
    redirect("/login?unverified=1");
  }
  
  // Security Check 2: Session Age (12 Hour Hard Limit)
  const lastSignInAt = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  const maxSessionAgeMs = 12 * 60 * 60 * 1000;
  if (lastSignInAt && Date.now() - lastSignInAt > maxSessionAgeMs) {
    redirect("/login?reauth=1");
  }

  // Pre-fetch chats for initial hydration
  // This speeds up the sidebar load time significantly
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiBase = apiUrl ? apiUrl.replace(/\/$/, "") + "/v1" : null;
  let chats: any[] = [];
  
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/chats?limit=50`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });
      if (res.ok) {
        const payload = await res.json();
        chats = payload?.chats || [];
      }
    } catch (error) {
      console.warn("Dashboard chats fetch failed", error);
    }
  }

  return (
    <DashboardShell initialChats={chats || []}>{children}</DashboardShell>
  );
}