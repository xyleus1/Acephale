import { logout } from "@/lib/auth";

export function LogoutButton() {
  async function logoutAction() {
    "use server";
    await logout();
  }

  return (
    <form action={logoutAction}>
      <button className="logout-btn" type="submit">
        ↩ Sign out
      </button>
    </form>
  );
}

