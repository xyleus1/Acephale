// Segment-level loading UI: shows instantly on every dashboard navigation
// while the server component renders. The 120ms fade-in delay (see
// .skel-page) keeps fast navigations flash-free.
export default function DashboardLoading() {
  return (
    <div className="skel-page" aria-busy="true" aria-label="Loading page">
      <div className="skel skel-eyebrow" />
      <div className="skel skel-title" />
      <div className="skel-row">
        <div className="skel skel-stat" />
        <div className="skel skel-stat" />
        <div className="skel skel-stat" />
        <div className="skel skel-stat" />
      </div>
      <div className="skel skel-block" />
      <div className="skel skel-block short" />
    </div>
  );
}
