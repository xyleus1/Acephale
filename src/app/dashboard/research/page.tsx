import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: { absolute: "Research" } };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const query = params.error ? `&error=${encodeURIComponent(params.error)}` : "";
  redirect(`/dashboard/supply-os?panel=materials&materialsView=projects${query}`);
}
