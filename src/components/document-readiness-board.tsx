import { Icon } from "./icon";
import { buildDocumentReadiness, type DocumentReadinessDoc } from "@/lib/document-readiness";

function pct(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function DocumentReadinessBoard({
  docs,
  title = "Document control",
}: {
  docs: DocumentReadinessDoc[];
  title?: string;
}) {
  const readiness = buildDocumentReadiness(docs);

  return (
    <div className={`doc-readiness-board ${readiness.tone}`}>
      <div className="doc-readiness-head">
        <div>
          <div className="doc-readiness-title">{title}</div>
        </div>
        <div className="doc-readiness-score">
          <strong>{readiness.readinessPct}%</strong>
          <span>approved</span>
        </div>
      </div>

      <div className="doc-readiness-bar" aria-label={`${readiness.approved} approved, ${readiness.uploaded} uploaded, ${readiness.pending} pending`}>
        <span className="approved" style={{ width: `${pct(readiness.approved, readiness.total)}%` }} />
        <span className="uploaded" style={{ width: `${pct(readiness.uploaded, readiness.total)}%` }} />
        <span className="pending" style={{ width: `${pct(readiness.pending, readiness.total)}%` }} />
      </div>

      <div className="doc-readiness-grid">
        <div>
          <span>Approved</span>
          <strong>{readiness.approved}/{readiness.total}</strong>
        </div>
        <div>
          <span>Uploaded</span>
          <strong>{readiness.uploaded}</strong>
        </div>
        <div>
          <span>Extracted fields</span>
          <strong>{readiness.extractedFields}</strong>
        </div>
        <div>
          <span>Flags</span>
          <strong>{readiness.flags}</strong>
        </div>
      </div>

      <div className="doc-readiness-lower">
        <div className="doc-readiness-queue">
          <div className="doc-readiness-label">Next document work</div>
          {readiness.pendingDocs.length === 0 ? (
            <div className="doc-readiness-empty">
              <Icon name="check" size={13} />
              All required files are approved.
            </div>
          ) : (
            readiness.pendingDocs.map((doc) => (
              <div key={doc.id} className="doc-readiness-task">
                <span className={doc.status.toLowerCase()} />
                <strong>{doc.name}</strong>
                <em>{doc.status.toLowerCase()}</em>
              </div>
            ))
          )}
        </div>
        <div className="doc-readiness-evidence">
          <div className="doc-readiness-label">{readiness.label}</div>
          <strong>{readiness.metric}</strong>
          <span>{readiness.detail}</span>
        </div>
      </div>
    </div>
  );
}
