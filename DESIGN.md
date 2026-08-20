# Derya interface system

## Authority and scope

This file is the source of truth for the visual and copy system across the entire authenticated app and customer-facing product surfaces. New screens, redesigns, components, and agent-generated UI must follow it. Existing screens migrate toward it when touched.

Product truth, provenance, uncertainty, legal notices, destructive-action warnings, and approval boundaries always remain visible. The design system may simplify their presentation but may not remove or weaken them.

## Direction

The target is 80 percent airy and 20 percent compact operational UI.

Airy means generous negative space, calm grouping, soft geometry, restrained color, strong typography, and one obvious action. It does not mean oversized marketing copy or empty decoration. Compact means tables, dense object lists, evidence details, and operational controls may use space efficiently inside a clearly bounded work area.

Pallet.com is the primary visual reference for whitespace, short labels, soft geometry, and immediate legibility. DualEntry and Campfire are secondary references for editorial spacing, thin dividers, calm selected states, and open panel composition. Kpler, Windward, and Pole Star Global are interaction references for geographic operations, evidence, and selected-object inspection. Do not copy any company's branding, assets, or exact layout.

## Product copy

Visible product copy must do at least one of these jobs:

1. Identify an object, state, source, or scope.
2. Name an action the user can take.
3. Explain a blocker, consequence, uncertainty, or approval boundary.
4. Prevent a material operational mistake.

If a phrase does none of those jobs, remove it.

Do not add:

- Marketing-style eyebrow labels above a page title.
- Page slogans or generic value claims.
- Introductory paragraphs that explain what the visible interface already shows.
- Subtitles that repeat a heading in longer words.
- Instructions such as "select an object" when the interaction is obvious.
- Claims about intelligence, ease, speed, modernity, or visibility.
- Placeholder prose added to make an empty area feel intentional.
- Buzzwords such as command center, decision intelligence, modeled workspace, or single source of truth.

The phrases "Supply OS / Logistics," "See every movement in one place," and "Inspect suppliers, transport legs, customs handoffs, and delivery points" are examples of prohibited filler. Do not paraphrase them. Remove that layer of copy entirely.

Necessary copy includes evidence labels, provenance, demo status, uncertainty, missing inputs, legal or compliance context, destructive-action consequences, and human-approval requirements. Keep it factual and short.

Examples:

| Avoid | Use |
| --- | --- |
| See every movement in one place. | No heading. Start with the network. |
| Select an object to see what is known. | No instruction. Make objects visibly selectable. |
| Three decisions need attention. | 3 decisions |
| Ranked by production impact and evidence readiness. | Show the ranking and evidence state. |
| This powerful view helps you optimize logistics. | Remove it. |
| Candidate relationship, not confirmed supply. | Keep it. This prevents a factual mistake. |
| Human decision required. | Keep it. This preserves the approval boundary. |

Use sentence case. Prefer nouns, facts, dates, counts, and verbs. Avoid exclamation marks. A heading should usually be one to four words. A button should usually be one to three words.

## Color

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f7f8f7` | App background and generous open space |
| Surface | `#ffffff` | Primary work surfaces |
| Surface subtle | `#f1f3f2` | Quiet grouping and inactive controls |
| Surface selected | `#eaf0f2` | Selected rows and active context |
| Line | `#e0e4e2` | Default dividers |
| Line strong | `#c7ceca` | Inputs and bounded work areas |
| Ink | `#1b1d1c` | Primary text and strongest actions |
| Ink secondary | `#4d5552` | Supporting operational text |
| Ink muted | `#747c78` | Metadata and labels |
| Operational navy | `#29485c` | Active routes, focus, and workstream links |
| Decision clay | `#a76b45` | Human decisions and unconfirmed evidence |
| Success | `#3f6c55` | Confirmed healthy state |

Use neutral surfaces for most of the interface. Accent color communicates state or action, not decoration. Do not use gradients, glows, saturated status fields, random accent blocks, or colored cards without semantic meaning.

## Typography

- Use Instrument Sans for interface text, headings, navigation, and actions.
- Use IBM Plex Mono only for timestamps, identifiers, counts, evidence labels, coordinates, and stage numbers.
- Use a system sans fallback while web fonts load.
- Primary page or object headings: 24 to 38px, weight 560 to 650, tight tracking.
- Section headings: 14 to 20px, weight 600 to 650.
- Body and controls: 13 to 15px.
- Metadata: 10 to 12px. Do not use tiny text to hide uncertainty.
- Use no more than three visible type sizes in one bounded panel unless a table requires otherwise.

Typography creates hierarchy before borders or background colors do.

## Spacing and density

Use a 4px base grid.

| Context | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Page edge | 40 to 48px | 24 to 32px | 16 to 20px |
| Major section gap | 32 to 48px | 24 to 32px | 20 to 24px |
| Panel padding | 20 to 28px | 18 to 24px | 16 to 20px |
| Related control gap | 8 to 12px | 8 to 12px | 8px |
| Row height | 56 to 64px | 52 to 60px | 48 to 56px |

Default to comfortable density. Compact density is allowed for tables, timelines, object lists, and comparison matrices. Do not make the whole app compact because one data surface is dense.

Open space must separate concepts, not pad every element equally. Prefer one generous outer workspace with compact information inside it.

## Geometry

The previous square-box style is retired.

- Inline tags and segmented-control selections: 8px radius.
- Buttons, inputs, selected rows, and menu items: 10px radius.
- Floating panels and side dossiers: 12 to 14px radius.
- Main workspaces, maps, dialogs, and sheets: 16px radius.
- Pills are reserved for status, filters, and short categorical values.
- Circular geometry is reserved for avatars, map markers, and status dots.

Do not wrap every label, metric, or paragraph in a box. Use whitespace and dividers first. A border is justified only when it defines a real work object, input boundary, selection, or safety boundary.

Shadows are soft and scarce. Use them only when a panel overlaps a map or another surface. A normal in-flow panel should usually have a border and no shadow.

## App shell

1. The persistent top ribbon identifies the current company and only the operational facts needed globally.
2. The persistent left navigation switches domains without changing product identity.
3. Do not repeat the product name, company, domain, or page purpose in a second title block.
4. If the ribbon, navigation, and workspace already establish context, start directly with the work object.
5. One screen should have one visually dominant work area and one dominant next action.
6. Utility controls belong near the object they affect, not in a generic page hero.
7. Desktop domain navigation may collapse to a numbered 84px rail. Keep full labels by default, preserve accessible names when collapsed, and return to horizontal labeled navigation below 900px.

The company directory uses rows, not cards. Company creation is inline or uses a dedicated page region. Primary operations do not depend on hover-only or modal-only interactions.

Do not fill unused rail space for visual balance. Lower-rail utilities must be real global actions, visually separated from the domain switcher, and useful from every domain.

### Context conversation

Context is a deliberate dark-surface exception inside the authenticated shell.
It uses one full-height conversation, one bottom composer, and one right file
rail on desktop. Do not expose the context hierarchy, fact database, source
linker, or outbound drafts as competing panels on this screen. On mobile, the
file rail becomes a full-screen sheet and the composer remains pinned above the
safe area. Uploaded files must show their name, type, size, and processing state.

## Maps and operational workspaces

The map is a bounded primary workspace, not full-page wallpaper and not a decorative card. Keep generous canvas around the workspace. Inside it, object rails and dossiers may be denser.

- Use MapLibre GL JS through React MapLibre.
- Use maintained basemaps, symbols, and accessible controls.
- Use Lucide for operational icons and Radix primitives for menus, tabs, and tooltips.
- Do not draw custom geography, pictograms, or controls when a maintained component exists.
- Keep the object list and dossier usable if the map renderer fails.
- Click or keyboard selection updates the persistent dossier. Hover is supplemental only.
- Inferred routes are dashed. Confirmed routes are solid.
- Map attribution remains visible.

Every node and relationship must identify its evidence class:

- Official evidence
- Public evidence
- Customer input
- Inferred pattern

Known endpoints do not prove that a movement occurred. Public evidence does not become official evidence. Candidate suppliers are qualification targets, not confirmed relationships.

## Components

### Buttons

- Minimum height: 42px desktop and 44px touch layouts.
- Primary: dark ink or operational navy fill. Use once per decision region.
- Secondary: neutral surface with a visible line.
- Quiet: text or icon control with no permanent border.
- Labels describe the action, not the benefit.
- Focus uses a 2px operational navy outline with 2px offset.

### Panels

- Use a panel for one coherent object or task, not for visual decoration.
- Panel headers contain a direct label, optional factual count, and local controls.
- Do not add descriptive subtitles beneath obvious panel headings.
- Prefer a single divider between header, body, and action region.

### Lists and tables

- Lists use full-row hit targets and quiet selected backgrounds.
- Tables align numbers and dates with tabular figures.
- Avoid card grids for records that users need to compare.
- Keep status and provenance visible without making every cell a badge.

### Forms

- Labels stay visible. Placeholder text is an example, not a label.
- Group related inputs with spacing before adding containers.
- Validation states state the problem and the correction.
- Dangerous or external actions state the consequence and approval requirement.

### Empty states

- Name what is missing.
- Offer one relevant action when an action exists.
- Do not add illustrations, slogans, or paragraphs to occupy space.
- Do not invent sample transactions or operational facts.

## Motion

- Use 120 to 180ms transitions for hover, selection, panel entry, and disclosure.
- Prefer opacity and small position changes. Avoid bouncing, sweeping, or staged decorative motion.
- Respect `prefers-reduced-motion`.
- Motion must explain state change, not advertise polish.

## Responsive behavior

- Preserve readable labels as long as possible. Do not collapse critical navigation to unexplained icons at medium widths.
- At narrow widths, transform side panels into full-width rows or sheets.
- Keep the current company, current domain, evidence state, and primary action available.
- Never shrink operational text below readable size to preserve a desktop layout.
- Allow dense tables to scroll horizontally inside their own region.

## Prohibited patterns

- Marketing heroes inside the authenticated product
- Generic page intros and explanatory filler
- Repeated product, company, domain, or object labels
- Square enterprise buttons and panels
- Cards created only to fill space
- A box around every metric or sentence
- More than one visually dominant primary action in a decision region
- Full-background maps that erase information hierarchy
- Modal or hover-popup workflows for primary operation
- Decorative gradients, glows, glass effects, or saturated accent fields
- Fake rates, shipment states, customers, suppliers, or system connections
- Tiny gray copy used to hide uncertainty
- AI model names, internal slogans, and inflated product claims

## Agent implementation contract

Before changing visible UI, agents must:

1. Read this file.
2. Reuse existing tokens and maintained components before inventing variants.
3. Remove redundant copy encountered in the touched surface.
4. Check desktop and mobile behavior in proportion to the change.
5. Preserve provenance, demo labels, uncertainty, and approval boundaries.
6. Run product-copy checks and relevant UI contracts.
7. Update this file and `docs/DECISIONS.md` when introducing a durable visual pattern.

A screenshot or image is a review artifact, not the design system. The durable system is this document plus coded tokens, shared components, automated checks, and review requirements.
