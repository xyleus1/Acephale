import { redirectLegacyOperatorSurface } from "./legacy-operator-redirect";

export default function DashboardRedirectPage() {
  redirectLegacyOperatorSurface("materials");
}
