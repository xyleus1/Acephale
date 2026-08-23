export type CustomerPortalNavigationContext = {
  companyId: string;
  isPreview: boolean;
};

export function customerPortalWorkspaceHref(
  companyId: string,
  isPreview = false,
) {
  const href = `/portal/workspace?company=${encodeURIComponent(companyId)}`;
  return isPreview ? `${href}&preview=1` : href;
}

export function customerPortalProcurementHref(companyId: string) {
  return `/portal/procurement?company=${encodeURIComponent(companyId)}`;
}

export function customerPortalShipmentHref(
  jobId: string,
  context?: CustomerPortalNavigationContext,
) {
  const href = `/portal/shipments/${encodeURIComponent(jobId)}`;
  if (!context?.isPreview) return href;
  return `${href}?company=${encodeURIComponent(context.companyId)}&preview=1`;
}

export function customerPortalDocumentHref(
  documentId: string,
  isPreview = false,
) {
  const encodedId = encodeURIComponent(documentId);
  return isPreview
    ? `/api/jobs/document/${encodedId}`
    : `/api/portal/documents/${encodedId}`;
}
