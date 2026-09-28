"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function LoginCard() {
  const params = useSearchParams();
  const hasError = params.get("error");

  return (
    <div className="login-card">
      <h1>엄마의 낭독 스튜디오</h1>
      <p className="subtitle">가족 전용 공간이에요. 구글 계정으로 로그인해주세요.</p>
      {hasError && (
        <p className="error" style={{ marginBottom: 16 }}>
          이 계정은 허용되지 않았어요. 가족 구성원의 계정으로 로그인해주세요.
        </p>
      )}
      <button type="button" onClick={() => signIn("google", { callbackUrl: "/" })}>
        Google로 로그인
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="login-screen">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </div>
  );
}
