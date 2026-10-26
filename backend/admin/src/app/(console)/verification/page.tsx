import { redirect } from "next/navigation";

/** Older link. The live page is Verified Accounts. */
export default function VerificationRedirectPage() {
  redirect("/verified-accounts");
}
