# Supply OS interface system

## Scope

This system governs the customer-facing Supply OS dashboard, customer builder, and linked workstream shells. It does not replace the older internal CRM interface.

## Product thesis

Supply OS is a working model of how a customer's physical operation may function and what should change next. The interface must answer four questions in order:

1. What does the company make and where does it operate?
2. What supplier-to-customer network is supported, customer stated, or inferred?
3. What weakness is most likely to hurt cost, lead time, or continuity?
4. What decision and input unlock the next action?

The map is the working surface, not decoration. The selected object and its next action are the primary output, not a collection of metrics.

## Reference patterns

- Kpler: make geography and movement the primary operating surface.
- Windward: keep evidence, confidence, and the selected-object dossier close to the map.
- Pole Star Global: distinguish monitoring signals from confirmed operational records.
- Pallet: use restrained, legible controls around dense operating data.

Do not copy their branding. Reuse the interaction principles: one operating picture, compact dossiers, explicit evidence state, and a small number of strong actions.

## Visual language

The visual language is light industrial, quiet, and precise.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f2f4f5` | Page background and quiet separation |
| Panel | `#ffffff` | Primary working surfaces |
| Subtle panel | `#f7f8f8` | Secondary controls and non-active regions |
| Selected panel | `#edf2f5` | Selected rows and action context |
| Line | `#d5dadd` | Default dividers |
| Strong line | `#aeb7bd` | Inputs, focus-adjacent controls, and confirmation boxes |
| Ink | `#172027` | Primary text and strongest actions |
| Soft ink | `#3f4c55` | Explanatory text |
| Muted ink | `#6d7880` | Metadata, provenance, and labels |
| Operational navy | `#29485c` | One restrained accent for active routes and workstream links |

No gradients, glows, decorative shadows, saturated status colors, or random accent blocks. Selected states use a border, a quiet background change, and font weight. They do not use bottom underlines.

## Typography

- Use IBM Plex Sans for UI, narrative, and actions.
- Use IBM Plex Mono only for addresses, evidence labels, timestamps, counts, and stage numbers.
- Page headings use 24 to 42 px depending on context.
- Section headings use 16 to 22 px.
- Primary body copy uses 13 to 14 px on desktop and never drops below 11 px for operational detail.
- Metadata may use 9 to 10 px only when the same information is available through semantic labels or nearby body copy.

Use sentence case. Avoid slogans, model names, internal jargon, and inflated claims.

## Layout

The customer dashboard is one fixed-height operating view. The document must not scroll at supported desktop and presentation sizes.

1. A compact header identifies the customer, operating site, scope, and evidence counts.
2. A narrow left rail lists supplier, customs, factory, distribution, and customer objects in physical-flow order.
3. A full-bleed map occupies the remaining canvas.
4. A right dossier describes the selected object, local contacts, checks, and the single next action.
5. A compact bottom strip explains status and the planning boundary.

Panels sit over the map instead of pushing it into a card. At narrower widths, the rail and dossier become smaller overlays. The new-customer builder remains a separate route because it is an input workflow, not part of the operating picture.

## Map, components, and provenance

Use maintained components instead of drawing map chrome or operational symbols in application code:

- MapLibre GL JS through React MapLibre for the map, route layers, markers, popups, scale, navigation, and attribution.
- OpenFreeMap Positron for the neutral vector basemap.
- Lucide for supplier, factory, warehouse, movement, customs, and location symbols.
- Radix primitives for menus and tooltips.

Do not add a hand-drawn SVG geography, invented pictograms, decorative map widgets, or proprietary copied assets. If WebGL 2 is unavailable, keep the object rail and dossier usable and show a bounded renderer notice in the map canvas.

Every node must be one of:

- Official evidence
- Public evidence
- Customer input
- Inferred pattern

Public evidence never becomes official evidence, and known endpoints never prove that a movement occurred. Inferred movement uses a dashed route, a hollow point, and explicit copy. Candidate suppliers and buyer profiles must say that they are qualification targets, not known relationships.

The map zooms to the current network. Routes remain dashed while they are planning hypotheses. Markers use one neutral shell, a standard symbol, and status color only. Hover or keyboard focus opens a compact contact card. Click selects the object and updates the persistent dossier.

## Operating action

The selected-object dossier contains only information required to understand and advance that part of the network:

1. Object type, place, status, and evidence basis
2. Cargo or operational scope
3. Candidate contacts with role and fit
4. Readiness checks when applicable
5. One next action and one linked workstream

A workstream link must carry the customer case identifier and must never imply that a supplier, booking, filing, or spend action is already live.

## Controls

- Primary actions use dark ink or operational navy, never multiple competing colors.
- Secondary actions are white with a visible border.
- Minimum interactive height is 42 px on desktop and 44 px on mobile.
- Focus state is a 2 px operational navy outline with a 2 px offset.
- Links inside evidence or candidate lists use navy text without an underline.
- Disclosure rows use a chevron and full-row hit target.

## Customer builder

The builder has one primary input and one primary action. Research progress reports what source is being checked and whether the result is verified or assumed. If public research fails, the builder must still produce a draft from the customer's description. It must never end on a dead result screen.

## Empty and future workstreams

Future workstream routes may be present before execution tools are connected. They must show the customer-specific starting condition, recommendation, decision, and required input. They must explicitly state that no supplier, booking, filing, or spend action is active. Do not fill unfinished pages with fake tables or sample transactions.

## Prohibited patterns

- Decorative corner logo tiles inside Supply OS
- Tab selection represented by a random bottom bar
- Cards created only to fill space
- Repeated summaries that do not change the next decision
- Stacked report sections that force the customer dashboard to scroll
- Custom-drawn maps, icons, or controls when a maintained library component exists
- Generic provider lists without scope, evidence, or a customer-specific reason
- Fake rates, shipment status, customers, suppliers, or system connections
- Buzzword headings such as command center, modeled workspace, or decision intelligence
- Tiny gray text used to hide uncertainty
