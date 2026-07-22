import { BottomNavClient } from "@/components/bottom-nav-client";
import { getCurrentRoleCodes } from "@/lib/auth/roles";

export async function BottomNav() {
  const { roles } = await getCurrentRoleCodes();

  return <BottomNavClient roles={roles} />;
}
