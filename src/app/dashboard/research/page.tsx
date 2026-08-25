import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createResearchList, listResearchLists } from "@/lib/research-lists";
import styles from "./research.module.css";

export const metadata: Metadata = { title: { absolute: "Research" } };

async function createListAction(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (session.accessKind === "customer") redirect("/dashboard/supply-os");
  const lines = String(formData.get("fields") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = lines.map((line) => {
    const [key, label, type = "text"] = line.split(":").map((part) => part.trim());
    return { key, label, type };
  });
  try {
    await createResearchList(session.officeId, {
      name: String(formData.get("name") || ""),
      slug: String(formData.get("slug") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
      fields,
    });
    revalidatePath("/dashboard/research");
  } catch {
    redirect("/dashboard/research");
  }
  redirect("/dashboard/research");
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireSession();
  if (session.accessKind === "customer") redirect("/dashboard/supply-os");
  const lists = await listResearchLists(session.officeId);
  const params = await searchParams;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Research</h1>
        <span className={styles.counts}>{lists.length} lists</span>
      </header>
      {params.error ? <p className={styles.error}>{params.error}</p> : null}
      <section className={styles.createPanel}>
        <div className={styles.sectionHeader}>
          <h2>Create list</h2>
          <span className={styles.meta}>Up to 40 columns per list</span>
        </div>
        <form action={createListAction} className={styles.createForm}>
          <label>
            <span>Name</span>
            <input name="name" required maxLength={160} />
          </label>
          <label>
            <span>Slug</span>
            <input name="slug" maxLength={80} placeholder="Optional" />
          </label>
          <label>
            <span>Description</span>
            <input name="description" maxLength={1000} />
          </label>
          <label className={styles.fieldDefinition}>
            <span>Columns, one per line: key:label:type</span>
            <textarea
              name="fields"
              required
              rows={5}
              placeholder={"company_name:Company name:text\nwebsite:Website:url\ncontact_email:Email:email"}
            />
          </label>
          <button type="submit">Create list</button>
        </form>
      </section>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>Records</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((list) => (
              <tr key={list.id}>
                <td>
                  <a href={`/dashboard/research/${encodeURIComponent(list.slug)}`}>
                    <strong>{list.name}</strong>
                  </a>
                  {list.description ? <span className={styles.meta}>{list.description}</span> : null}
                </td>
                <td>{list.fields.map((field) => field.label).join(", ")}</td>
                <td className={styles.numeric}>{list.recordCount}</td>
                <td>{list.updatedAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lists.length === 0 ? (
        <p className={styles.empty}>No research lists yet.</p>
      ) : null}
    </main>
  );
}
