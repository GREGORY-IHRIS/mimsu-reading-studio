import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "엄마의 낭독 스튜디오",
  description: "내가 쓴 글을 목소리로 들어보는 곳",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
