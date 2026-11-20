"use server";

import { authentication } from "@/server/auth";

export async function signInWithGitHub() {
  if (authentication) await authentication.signIn("github", { redirectTo: "/" });
}

export async function signOut() {
  if (authentication) await authentication.signOut({ redirectTo: "/" });
}
