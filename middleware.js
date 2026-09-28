import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

// Only guards page navigations. API routes are excluded on purpose — they
// each check the session themselves and return a clean 401 JSON error,
// rather than having a fetch() call silently follow a redirect to the HTML
// login page (which would break res.json() on the client).
export const config = {
  matcher: ["/((?!login|api/).*)"],
};
