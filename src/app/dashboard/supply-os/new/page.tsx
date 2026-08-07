import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { SupplyOsCaseGenerator } from "../supply-os-generator";
import styles from "../supply-os-workspace.module.css";

export const metadata: Metadata = {
  title: "New customer | Supply OS",
  description: "Create a customer supply chain dashboard.",
};

export default async function NewSupplyOsCustomerPage() {
  const session = await requireSession();
  return (
    <div className={styles.pageFrame}>
      <SupplyOsCaseGenerator storageScope={`${session.officeId}:${session.userId}`} />
    </div>
  );
}
