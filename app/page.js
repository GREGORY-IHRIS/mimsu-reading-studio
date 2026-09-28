import { getServerSession } from "next-auth/next";
import { authOptions } from "../lib/authOptions";
import StudioClient from "../components/StudioClient";

export default async function Page() {
  const session = await getServerSession(authOptions);
  return <StudioClient userEmail={session?.user?.email} userName={session?.user?.name} />;
}
