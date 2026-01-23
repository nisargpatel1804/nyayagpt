import type { Metadata } from "next";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalErrorListener from "@/components/GlobalErrorListener";

export const metadata: Metadata = {
  title: "NyayaGPT",
  description: "Your AI Legal Companion for Indian Law"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-white">
        <GlobalErrorListener />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}