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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiBase = apiUrl ? apiUrl.replace(/\/$/, "") + "/v1" : null;
  let chats: any[] = [];
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/chats`, {
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