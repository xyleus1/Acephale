import { Icon } from "@/components/icon";
import {
  buildLoadRoutePlan,
  loadRouteSvgPath,
  projectLoadRoutePoint,
  type LoadRouteMode,
} from "@/lib/load-route-map";
import {
  WorldMapBase,
  worldMapBaseSize,
  worldMapBaseViewBox,
} from "@/components/intelligence/world-map-base";
import styles from "./load-route-map.module.css";

export type LoadRouteMapProps = {
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  etdLabel?: string | null;
  etaLabel?: string | null;
  nextMilestoneLabel?: string | null;
  className?: string;
  compact?: boolean;
};

function iconForMode(mode: LoadRouteMode) {
  if (mode === "OCEAN") return "ship" as const;
  if (mode === "AIR") return "plane" as const;
  return "truck" as const;
}

function modeLabel(mode: LoadRouteMode) {
  if (mode === "OCEAN") return "Ocean";
  if (mode === "AIR") return "Air";
  if (mode === "RAIL") return "Rail";
  return "Road";
}

export function LoadRouteMap({
  origin,
  destination,
  mode,
  etdLabel,
  etaLabel,
  nextMilestoneLabel,
  className,
  compact = false,
}: LoadRouteMapProps) {
  const plan = buildLoadRoutePlan({ origin, destination, mode });
  const classes = [
    styles.shell,
    compact ? styles.compact : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const hasOceanLeg = plan.legs.some((leg) => leg.mode === "OCEAN");
  const hasLandLeg = plan.legs.some((leg) => leg.mode !== "OCEAN");

  return (
    <section className={classes} data-load-route-map>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Movement plan</span>
          <strong>
            {plan.origin.label} <span aria-hidden>to</span> {plan.destination.label}
          </strong>
        </div>
        <div className={styles.timing}>
          <span>{etdLabel || "ETD not confirmed"}</span>
          <span>{etaLabel || "ETA not confirmed"}</span>
        </div>
      </header>

      {plan.canRender ? (
        <>
          <div className={styles.mapCanvas}>
            <svg
              viewBox={worldMapBaseViewBox}
              role="img"
              aria-label={`Planned route from ${plan.origin.label} to ${plan.destination.label}`}
              style={worldMapBaseSize}
            >
              <WorldMapBase />
              <g className={styles.routeLayer}>
                {plan.legs.flatMap((leg) => (
                  leg.pathSegments.map((segment, index) => (
                    <path
                      key={`${leg.id}-${index}`}
                      d={loadRouteSvgPath(segment)}
                      className={leg.mode === "OCEAN" ? styles.oceanPath : styles.landPath}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))
                ))}
              </g>
              <g>
                {plan.stops.map((stop, index) => {
                  const point = projectLoadRoutePoint(stop.point);
                  const labelLeft = point.x > 760;
                  return (
                    <g key={stop.id}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="10"
                        className={styles.markerHalo}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="5"
                        className={index === 0 ? styles.originMarker : styles.destinationMarker}
                      />
                      <text
                        x={point.x + (labelLeft ? -12 : 12)}
                        y={point.y - 10}
                        textAnchor={labelLeft ? "end" : "start"}
                        className={styles.markerLabel}
                      >
                        {stop.point.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className={styles.mapLegend}>
              {hasOceanLeg ? <span><i className={styles.oceanKey} /> Ocean</span> : null}
              {hasLandLeg ? <span><i className={styles.roadKey} /> Land</span> : null}
            </div>
          </div>

          {plan.routeNotice ? (
            <div className={styles.routeNotice} role="note">
              <Icon name="alert" size={14} />
              <span>{plan.routeNotice}</span>
            </div>
          ) : null}

          <ol className={styles.stopRail} aria-label="Planned route legs">
            {plan.stops.map((stop, index) => (
              <li key={stop.id}>
                <span className={styles.stopIndex}>{index + 1}</span>
                <div>
                  <small>{stop.eyebrow}</small>
                  <strong>{stop.point.label}</strong>
                </div>
                {stop.modeAfter ? (
                  <span className={styles.modeChip}>
                    <Icon name={iconForMode(stop.modeAfter)} size={12} />
                    {modeLabel(stop.modeAfter)}
                  </span>
                ) : (
                  <span className={styles.arrivalChip}>Arrival</span>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className={styles.unresolved}>
          <Icon name="alert" size={18} />
          <div>
            <strong>Route map needs precise shipment data</strong>
            <p>
              {plan.unresolvedLabels.join(" and ")} could not be resolved.
              Add a known city or freight port and transport mode before
              relying on the map.
            </p>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <span>
          <Icon name="info" size={12} />
          Planned route, not live tracking
        </span>
        {nextMilestoneLabel ? <strong>{nextMilestoneLabel}</strong> : null}
      </footer>
    </section>
  );
}
