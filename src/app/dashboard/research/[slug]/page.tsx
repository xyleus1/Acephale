import { redirect } from "next/navigation";

export default async function ResearchListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const search = new URLSearchParams({
    materialsView: "projects",
    researchList: slug,
  });
  if (filters.q) search.set("q", filters.q);
  if (filters.status) search.set("status", filters.status);
  if (filters.page) search.set("page", filters.page);
  redirect(`/dashboard/supply-os?panel=materials&${search.toString()}`);
}
