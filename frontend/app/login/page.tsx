import dynamic from "next/dynamic";
import { Suspense } from "react";

const LoginForm = dynamic(() => import("./LoginForm"), { ssr: false });

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <LoginForm />
    </Suspense>
  );
}