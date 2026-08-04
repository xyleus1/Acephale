import { revalidatePath } from "next/cache";
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { LogoMark } from "@/components/logo-mark";
import {
  submitCustomerQuoteResponse,
  uploadCustomerPortalDocument,
} from "@/lib/customer-portal-actions";
import {
  logoutCustomerPortal,
  requireCustomerPortalPrincipal,
} from "@/lib/customer-portal-auth";
import {
  loadCustomerPortalShipment,
  type CustomerPortalPrincipal,
} from "@/lib/customer-portal-data";
import {
  customerPortalDocumentHref,
  customerPortalShipmentHref,
  customerPortalWorkspaceHref,
} from "@/lib/customer-portal-navigation";
import { requireCustomerPortalPreviewPrincipal } from "@/lib/customer-portal-preview";
import {
  CUSTOMER_PORTAL_STATUS_ORDER,
  CUSTOMER_PORTAL_STATUS_SHORT_LABEL,
  customerPortalCanRespondToQuote,
} from "@/lib/customer-portal-view";
import styles from "../../portal-workspace.module.css";

export const metadata: Metadata = {
  title: { absolute: "Shipment tracking | Derya" },
};

type ShipmentParams = {
  company?: string;
  notice?: string;
  error?: string;
  preview?: string;
};

function fmtDate(value: Date | null | undefined) {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function fmtDateTime(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function quoteTotals(lines: Array<{ amount: number; cur: string }>) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isFinite(line.amount)) continue;
    totals.set(line.cur, (totals.get(line.cur) ?? 0) + line.amount);
  }
  return [...totals.entries()];
}

function equipmentLabel(shipment: {
  containerCount: number | null;
  containerType: string | null;
  packages: number | null;
  mode: string | null;
}) {
  if (shipment.containerCount && shipment.containerType) {
    return `${shipment.containerCount} x ${shipment.containerType}`;
  }
  if (shipment.packages) return `${shipment.packages.toLocaleString()} packages`;
  return shipment.mode ?? "To be confirmed";
}

function statusClass(status: string) {
  if (status === "DELIVERED") return styles.statusDone;
  if (status === "QUOTED") return styles.statusAlert;
  if (status === "CUSTOMS") return styles.statusCustoms;
  return styles.status;
}

export default async function CustomerPortalShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<ShipmentParams>;
}) {
  const { jobId } = await params;
  const query = await searchParams;
  const isPreview = query.preview === "1";
  const principal = isPreview
    ? await requireCustomerPortalPreviewPrincipal(query.company)
    : await requireCustomerPortalPrincipal();
  if (!principal) notFound();

  const data = await loadCustomerPortalShipment(principal as CustomerPortalPrincipal, jobId);
  if (!data) notFound();
  const shipment = data.shipment;
  const navigationContext = {
    companyId: data.company.id,
    isPreview,
  };
  const workspaceHref = customerPortalWorkspaceHref(data.company.id, isPreview);
  const currentShipmentHref = customerPortalShipmentHref(shipment.id, navigationContext);

  async function logoutAction() {
    "use server";
    await logoutCustomerPortal();
    redirect("/portal");
  }

  async function quoteResponseAction(formData: FormData) {
    "use server";
    const current = await requireCustomerPortalPrincipal();
    const companyId = String(formData.get("companyId") ?? "");
    const submittedJobId = String(formData.get("jobId") ?? "");
    const type = String(formData.get("type") ?? "") as "QUOTE_ACCEPTED" | "QUOTE_CHANGES_REQUESTED";
    const message = String(formData.get("message") ?? "");
    const result = await submitCustomerQuoteResponse({
      principal: current as CustomerPortalPrincipal,
      companyId,
      jobId: submittedJobId,
      type,
      message,
    });
    revalidatePath("/portal/workspace");
    revalidatePath(`/portal/shipments/${submittedJobId}`);
    const destination = `/portal/shipments/${encodeURIComponent(submittedJobId)}`;
    if (!result.ok) redirect(`${destination}?error=${result.error}` as Route);
    redirect(`${destination}?notice=${type === "QUOTE_ACCEPTED" ? "quote_accepted" : "changes_requested"}` as Route);
  }

  async function uploadDocumentAction(formData: FormData) {
    "use server";
    const current = await requireCustomerPortalPrincipal();
    const companyId = String(formData.get("companyId") ?? "");
    const submittedJobId = String(formData.get("jobId") ?? "");
    const documentId = String(formData.get("documentId") ?? "");
    const file = formData.get("file");
    const destination = `/portal/shipments/${encodeURIComponent(submittedJobId)}`;
    if (!(file instanceof File)) redirect(`${destination}?error=file_required#documents` as Route);
    const result = await uploadCustomerPortalDocument({
      principal: current as CustomerPortalPrincipal,
      companyId,
      jobId: submittedJobId,
      documentId,
      file,
    });
    revalidatePath("/portal/workspace");
    revalidatePath(`/portal/shipments/${submittedJobId}`);
    revalidatePath(`/dashboard/jobs/${submittedJobId}`);
    if (!result.ok) redirect(`${destination}?error=${result.error}#documents` as Route);
    redirect(`${destination}?notice=document_uploaded#documents` as Route);
  }

  const noticeText: Record<string, string> = {
    quote_accepted: "Your approval was sent to Derya operations. Booking remains under operator review.",
    changes_requested: "Your requested quote changes were sent to Derya operations.",
    document_uploaded: "Your document was uploaded for review.",
  };
  const errorText: Record<string, string> = {
    message_required: "Describe the quote change you need.",
    quote_unavailable: "This quote is no longer available for response.",
    not_allowed: "Your account cannot perform that action.",
    file_required: "Choose a document to upload.",
    file_too_large: "The file exceeds the 25 MB limit.",
    document_not_found: "That document request is no longer active.",
  };
  const totals = quoteTotals(shipment.quoteLines);
  const currentMilestoneId = shipment.nextMilestone?.id ?? null;
  const canAct = data.membership.role !== "VIEWER";
  const visibleDocumentCount = shipment.documents.length + (canAct ? shipment.documentRequests.length : 0);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <a href={workspaceHref} className={styles.brand}>
            <LogoMark className={styles.brandMark} />
            <div>
              <div className={styles.brandTitle}>{data.officeName}</div>
              <div className={styles.brandSub}>Shipment workspace</div>
            </div>
          </a>
          <nav className={styles.portalNav} aria-label="Customer workspace">
            <a className={styles.portalNavLink} href={workspaceHref}>Overview</a>
            <a aria-current="page" className={styles.portalNavActive} href={currentShipmentHref}>Shipment</a>
            <a className={styles.portalNavLink} href="mailto:rfq@usederya.com">New request</a>
          </nav>
          <div className={styles.userNav}>
            <span>{isPreview ? "Customer preview" : principal.email}</span>
            {isPreview ? (
              <a className={styles.signOutButton} href="/dashboard/customer-portal">Exit preview</a>
            ) : (
              <form action={logoutAction}>
                <button className={styles.signOutButton} type="submit">Sign out</button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {isPreview && (
          <aside className={styles.previewBanner} aria-label="Customer preview mode">
            <div>
              <strong>Customer preview: {data.company.name}</strong>
              <span>This is the member experience using current shipment data. Quote and upload actions are disabled.</span>
            </div>
            <a href="/dashboard/customer-portal">Exit preview</a>
          </aside>
        )}

        <a className={styles.backLink} href={workspaceHref}>
          <Icon name="arrow-left" size={14} /> All shipments
        </a>

        {query.notice && noticeText[query.notice] && (
          <div className={styles.notice}><Icon name="check" size={16} /> {noticeText[query.notice]}</div>
        )}
        {query.error && (
          <div className={styles.error}><Icon name="alert" size={16} /> {errorText[query.error] ?? "That action could not be completed."}</div>
        )}

        <section className={styles.trackingHero}>
          <div className={styles.trackingTopline}>
            <div>
              <div className={styles.eyebrow}>{shipment.reference}</div>
              <h1 className={styles.trackingTitle}>{shipment.title}</h1>
            </div>
            <div className={styles.trackingStatus}>
              <span className={statusClass(shipment.status)}>{shipment.statusLabel}</span>
              <span>Updated {fmtDateTime(shipment.updatedAt)}</span>
            </div>
          </div>

          <div className={styles.trackingRoute}>
            <div className={styles.trackingLocation}>
              <span>Origin</span>
              <strong>{shipment.origin ?? "To be confirmed"}</strong>
            </div>
            <div className={styles.trackingRouteLine} aria-hidden="true">
              <span />
              <Icon name={shipment.mode === "AIR" ? "plane" : shipment.mode === "ROAD" ? "truck" : "ship"} size={20} />
              <span />
            </div>
            <div className={styles.trackingLocationDestination}>
              <span>Destination</span>
              <strong>{shipment.destination ?? "To be confirmed"}</strong>
            </div>
          </div>

          <div className={styles.progress} aria-label={`Shipment progress: ${shipment.statusLabel}`}>
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ width: `${shipment.progressPercent}%` }} />
            </div>
            <div className={styles.progressSteps}>
              {CUSTOMER_PORTAL_STATUS_ORDER.map((status, index) => (
                <div
                  className={index <= shipment.progressIndex ? styles.progressStepDone : styles.progressStep}
                  key={status}
                >
                  <span className={styles.progressDot} aria-hidden="true" />
                  <span>{CUSTOMER_PORTAL_STATUS_SHORT_LABEL[status]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.trackingDates}>
            <div><span>Estimated departure</span><strong>{fmtDate(shipment.etd)}</strong></div>
            <div><span>Estimated arrival</span><strong>{fmtDate(shipment.eta)}</strong></div>
            <div>
              <span>Next milestone</span>
              <strong>{shipment.nextMilestone?.label ?? "No milestone pending"}</strong>
              {shipment.nextMilestone?.plannedAt && <small>{fmtDate(shipment.nextMilestone.plannedAt)}</small>}
            </div>
          </div>
          <p className={styles.trackingNote}>Tracking is based on milestones recorded by Derya, not live GPS or vessel position.</p>
        </section>

        <div className={styles.detailLayout}>
          <div className={styles.detailMain}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Shipment timeline</h2>
                  <p className={styles.cardCopy}>{shipment.completedMilestones} of {shipment.milestones.length} milestones confirmed.</p>
                </div>
              </div>
              <div className={styles.milestoneTimeline}>
                {shipment.milestones.length > 0 ? shipment.milestones.map((milestone, index) => {
                  const isCurrent = milestone.id === currentMilestoneId;
                  return (
                    <div className={styles.milestoneRow} key={milestone.id}>
                      <div className={styles.milestoneRail}>
                        <span className={milestone.actualAt ? styles.milestoneDotDone : isCurrent ? styles.milestoneDotCurrent : styles.milestoneDot} />
                        {index < shipment.milestones.length - 1 && <span className={milestone.actualAt ? styles.milestoneLineDone : styles.milestoneLine} />}
                      </div>
                      <div className={styles.milestoneCopy}>
                        <strong>{milestone.label}</strong>
                        <span>{milestone.actualAt ? "Confirmed" : isCurrent ? "Next milestone" : "Upcoming"}</span>
                      </div>
                      <time>{milestone.actualAt ? fmtDate(milestone.actualAt) : fmtDate(milestone.plannedAt)}</time>
                    </div>
                  );
                }) : <div className={styles.empty}>Milestones will appear after booking.</div>}
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Shipment details</h2>
                  <p className={styles.cardCopy}>Cargo and handling details recorded for this shipment.</p>
                </div>
              </div>
              <div className={styles.factGrid}>
                <div className={styles.fact}><span>Mode</span><strong>{shipment.mode ?? "To be confirmed"}</strong></div>
                <div className={styles.fact}><span>Equipment</span><strong>{equipmentLabel(shipment)}</strong></div>
                <div className={styles.fact}><span>Commodity</span><strong>{shipment.commodity ?? "To be confirmed"}</strong></div>
                <div className={styles.fact}><span>Incoterms</span><strong>{shipment.incoterms ?? "To be confirmed"}</strong></div>
                <div className={styles.fact}><span>Weight</span><strong>{shipment.weight != null ? `${shipment.weight.toLocaleString()} kg` : "To be confirmed"}</strong></div>
                <div className={styles.fact}><span>Volume</span><strong>{shipment.volume != null ? `${shipment.volume.toLocaleString()} cbm` : "To be confirmed"}</strong></div>
              </div>
            </section>

            {shipment.quoteLines.length > 0 && (
              <section className={styles.card} id="quote">
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Customer quote</h2>
                    <p className={styles.cardCopy}>Pricing currently attached to this shipment.</p>
                  </div>
                  {totals.length === 1 && <strong className={styles.quoteTotal}>{totals[0][1].toLocaleString()} {totals[0][0]}</strong>}
                </div>
                <div className={styles.quoteLines}>
                  {shipment.quoteLines.map((line, index) => (
                    <div className={styles.quoteLine} key={`${line.desc}-${index}`}>
                      <span>{line.desc}</span>
                      <strong>{line.amount.toLocaleString()} {line.cur}</strong>
                    </div>
                  ))}
                  {totals.length > 1 && totals.map(([currency, total]) => (
                    <div className={styles.quoteLineTotal} key={currency}>
                      <strong>Total {currency}</strong>
                      <strong>{total.toLocaleString()} {currency}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className={styles.detailAside}>
            {shipment.quoteLines.length > 0 && canAct && (
            <section className={styles.actionCard}>
              <h2>Quote decision</h2>
                {shipment.latestQuoteResponse && shipment.latestQuoteResponse.status !== "REJECTED" ? (
                  <div className={styles.actionResolved}>
                    <strong>{shipment.latestQuoteResponse.type === "QUOTE_ACCEPTED" ? "Quote approved" : "Changes requested"}</strong>
                    <span>Sent by {shipment.latestQuoteResponse.submittedBy}. Derya status: {shipment.latestQuoteResponse.status.toLowerCase()}.</span>
                  </div>
                ) : customerPortalCanRespondToQuote(shipment) && data.membership.role !== "VIEWER" ? isPreview ? (
                  <div className={styles.quoteActions}>
                    {shipment.latestQuoteResponse?.status === "REJECTED" && (
                      <div className={styles.inlineError}>The previous response was rejected. A customer can review the current quote and respond again.</div>
                    )}
                    <button className={styles.buttonWide} type="button" disabled>Approve quote</button>
                    <div className={styles.form}>
                      <label className={styles.label}>
                        Request a change
                        <textarea className={styles.textarea} disabled placeholder="Describe the pricing, scope, or timing change." />
                      </label>
                      <button className={styles.secondaryButtonWide} type="button" disabled>Send change request</button>
                    </div>
                    <p className={styles.actionFootnote}>Customer controls are visible but disabled in operator preview.</p>
                  </div>
                ) : (
                  <div className={styles.quoteActions}>
                    {shipment.latestQuoteResponse?.status === "REJECTED" && (
                      <div className={styles.inlineError}>The previous response was rejected. Review the current quote and respond again.</div>
                    )}
                    <form action={quoteResponseAction}>
                      <input type="hidden" name="companyId" value={data.company.id} />
                      <input type="hidden" name="jobId" value={shipment.id} />
                      <input type="hidden" name="type" value="QUOTE_ACCEPTED" />
                      <button className={styles.buttonWide} type="submit">Approve quote</button>
                    </form>
                    <form action={quoteResponseAction} className={styles.form}>
                      <input type="hidden" name="companyId" value={data.company.id} />
                      <input type="hidden" name="jobId" value={shipment.id} />
                      <input type="hidden" name="type" value="QUOTE_CHANGES_REQUESTED" />
                      <label className={styles.label}>
                        Request a change
                        <textarea className={styles.textarea} name="message" required placeholder="Describe the pricing, scope, or timing change." />
                      </label>
                      <button className={styles.secondaryButtonWide} type="submit">Send change request</button>
                    </form>
                    <p className={styles.actionFootnote}>Approval notifies Derya. It does not book freight automatically.</p>
                  </div>
                ) : (
                  <p className={styles.actionFootnote}>No quote decision is currently available.</p>
                )}
              </section>
            )}

            <section className={styles.card} id="documents">
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Documents</h2>
                  <p className={styles.cardCopy}>Requested uploads and approved files.</p>
                </div>
                <span className={styles.count}>{visibleDocumentCount}</span>
              </div>
              <div className={styles.documentList}>
                {shipment.documentRequests.length > 0 && canAct && (
                  <div className={styles.documentGroup}>
                    <div className={styles.documentGroupLabel}>Requested from you</div>
                    {shipment.documentRequests.map((document) => (
                      <div className={styles.documentRequest} key={document.id}>
                        <div className={styles.documentName}>
                          <span><Icon name="file" size={15} /></span>
                          <div><strong>{document.name}</strong><small>{document.status === "UNDER_REVIEW" ? "Uploaded, under review" : "Upload needed"}</small></div>
                        </div>
                        {document.status === "NEEDED" && (
                          isPreview ? (
                            <div className={styles.uploadForm}>
                              <input className={styles.fileInput} type="file" disabled />
                              <button className={styles.secondaryButtonWide} type="button" disabled>Upload document</button>
                            </div>
                          ) : (
                            <form action={uploadDocumentAction} className={styles.uploadForm}>
                              <input type="hidden" name="companyId" value={data.company.id} />
                              <input type="hidden" name="jobId" value={shipment.id} />
                              <input type="hidden" name="documentId" value={document.id} />
                              <input className={styles.fileInput} type="file" name="file" required />
                              <button className={styles.secondaryButtonWide} type="submit">Upload document</button>
                            </form>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.documentGroup}>
                  <div className={styles.documentGroupLabel}>Approved files</div>
                  {shipment.documents.length > 0 ? shipment.documents.map((document) => (
                    <a className={styles.documentLink} href={customerPortalDocumentHref(document.id, isPreview)} target="_blank" rel="noreferrer" key={document.id}>
                      <div className={styles.documentName}>
                        <span><Icon name="file-check" size={15} /></span>
                        <div><strong>{document.name}</strong><small>{document.docType} · {fmtDate(document.updatedAt)}</small></div>
                      </div>
                      <Icon name="external" size={14} />
                    </a>
                  )) : <div className={styles.empty}>No approved customer documents yet.</div>}
                </div>
              </div>
            </section>

            <section className={styles.supportCard}>
              <div>
                <strong>Need help with this shipment?</strong>
                <span>Reply to your latest Derya email and include the shipment reference.</span>
              </div>
              <a href="mailto:rfq@usederya.com">Email Derya</a>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
