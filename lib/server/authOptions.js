import GoogleProvider from "next-auth/providers/google";

function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // This is the actual access control: only these emails may ever get a
    // session, regardless of who has the link. Google sign-in only proves
    // identity — it does not grant permission by itself.
    async signIn({ user }) {
      const list = allowedEmails();
      if (list.length === 0) return false; // fail closed if misconfigured
      return list.includes((user.email || "").toLowerCase());
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "jwt" },
};
