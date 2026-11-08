# Design guide

This guide tells you how to make the web app look and work as one product. Obey it for each page and component. If a rule stops you, change this guide in the same pull request, and tell why.

## Direction: star atlas

The logo is オススメ, drawn as four constellations. The site looks like an old star atlas: paper in the light theme, night sky in the dark theme, gold for marks and actions, and a serif font for headings. It must not look like a stock template.

Keep the site calm. Align text on the left. Use thin rules, not shadows. Use the constellation motif in small quantities.

## Tokens

All colours are tokens in `apps/web/src/index.css`. Each token has a light value and a dark value. Each text and surface pair passes WCAG AA contrast in the two themes.

Use only tokens. Do not write a colour value in a page. Do not use `dark:` classes unless a token cannot do the work.

| Use | Classes |
| --- | --- |
| Surfaces | `bg-background` (page), `bg-card`, `bg-popover`, `bg-muted`, `bg-secondary`, `bg-accent` (hover) |
| Text | `text-foreground`, `text-muted-foreground`, `text-link`, `text-destructive` |
| Gold accent | `bg-primary` with `text-primary-foreground`. Use it only as a fill. |
| Lines | `border` for thin decorative lines. `border-input` for the outline of a control. |
| Star marks | `text-star`, `bg-star`. Only for decoration. |

**Do not use `text-primary`.** The gold text does not have sufficient contrast on paper. Use `text-link` for gold text.

Radius: `rounded-sm` for tags and small controls, `rounded-md` for buttons, inputs and covers, `rounded-lg` for cards and dialogs. Do not make pill shapes.

## Type

- Headings use `font-heading` (Newsreader, a serif font). `h1` and `h2` get it automatically. Use `font-medium` on serif headings, not `font-semibold`.
- All other text uses Geist.
- Sizes: page title `text-3xl sm:text-4xl`, section `text-xl`, item title `text-base font-medium`, body `text-sm`, caption `text-xs`.
- The `eyebrow` class makes a small caption in spaced capital letters.

## Focus and motion

- One global 2 px ring shows on `:focus-visible`. Do not add other rings. Do not use `outline-none`.
- Keep motion small: colour transitions and 100 ms fades. On the map, the series that you release moves back with a small spring. Its neighbours do not move.
- The global styles stop motion when the user sets "reduce motion". Do not add motion that ignores this setting.

## Status colours

Each list status has an icon, a colour and a label. Always show the three together with `<StatusBadge status={status} />`. Do not show only the colour, or only the label.

| Status | Colour | Icon |
| --- | --- | --- |
| Plan to watch | amber | bookmark |
| Watching | blue | play |
| Completed | green | check |
| On hold | violet | pause |
| Dropped | rose | x |

For a filter chip or a count, use `text-status-plan`, `text-status-watching`, `text-status-completed`, `text-status-hold` or `text-status-dropped`. For a tint, use `bg-status-<name>/14`. For an edge, use `border-status-<name>/40`.

For request and invite states, use `Badge`: `warning` for pending, `success` for approved or accepted, `destructive` for rejected, revoked or expired, and `secondary` for neutral facts such as roles and tags.

## Page layout

- `AppShell` gives `<main>` its maximum width (`max-w-7xl`), margins and a 56 px header that stays at the top. Do not add outer padding or a maximum width to a page.
- Start each page with `<PageHeader title description? eyebrow? actions? />`. It owns the `h1` and the rule below it. Put the main page action in `actions`.
- Start each section with `<SectionHeading actions?>`. Put sections in `flex flex-col gap-10`.
- Widths: pages to browse use the full width. Forms and settings use `max-w-xl`. Text to read uses `max-w-prose`. A detail page uses `grid lg:grid-cols-[16rem_1fr] gap-8`, with the cover in the narrow column.
- Cover grids use `grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6`. The cover is first. The title and status are below it.
- Rows of data use `divide-y` on a plain list. Do not put each row in a card. Use a card only for a group with limits, such as a form or a settings block.
- Filter chips use `buttonVariants({ variant: current ? 'default' : 'outline', size: 'sm' })` with `aria-current`, in a `flex flex-wrap gap-2` nav. On phones, let them go onto more lines. Do not make a horizontal scroll bar.

## Phones

- Check each page at 390 px width. The page must not scroll horizontally.
- Use `wrap-anywhere` on text that users write.
- The header changes at the `lg` breakpoint. Below `md`, controls become 44 px high automatically.
- On the map, phones can pan, zoom and open a series. Only a computer can move series or draw lines.

## Components

Use the components in `apps/web/src/components`. Do not make a new version of a component that exists.

- **Button**: `default` for the one main action of a view, `outline` for usual secondary actions, `ghost` for quiet actions and toolbars, `destructive` for removal, `link` in text. Use `sm` in rows and chips. An `icon` button needs an `aria-label`. To make a `Link` look like a button, use `buttonVariants`.
- **Links**: use `TextLink` for links in text. A title that opens its page is a plain `Link` with `text-foreground hover:underline`. A list of 30 underlined gold titles is noise.
- **Form fields**: do not use `Input`, `Textarea` or `NativeSelect` alone. Use `TextField`, `TextareaField` or `SelectField` from `form.tsx`, or a `Label` with `htmlFor`.
- **Card**: flat, one thin border, no shadow. Do not put a card in a card. `CardTitle` uses the serif font.
- **Alert**: it has `role="alert"` by default. For good news, set `role="status"`. Use `destructive` for errors.
- **Actions that you cannot undo**: use `ConfirmButton` or `AlertDialog`. Put the buttons on the left: Cancel first, then the action.
- **DropdownMenu**: not modal. An item takes `asChild` with a `Link`.
- **States**: use `QueryFallback`, `LoadingState`, `EmptyState`, `ErrorState` and `LoadMore` from `states.tsx`. A cover-grid placeholder is `aspect-[2/3] rounded-md bg-muted animate-pulse motion-reduce:animate-none`.
- **CoverImage**: always set `title={series.title}`, also when `alt=""`. The title selects the constellation on the placeholder. Without it, all missing covers look the same.
- **Motif**: `Constellation index={n}`, `ConstellationSky`, `LogoMark` and `LogoLockup` are in `logo-mark.tsx`. Use the `star-field` class only on logged-out pages.
- **Logged-out pages**: put forms in `PublicCard`. A logged-out page without `PublicCard` must show `<PublicBar />`, because it has the theme toggle.
- **Theme**: `ThemeToggle` is in the shell and in `PublicBar`. The theme is in localStorage, key `osusume-theme`. Pages do not read it. They use tokens.

## Constellations map

- The sky is `--background`. Stars and the selection use `--star`. Text on the map uses `--foreground`.
- Each series is a circle with its cover and a title plate below it.
- "Goes together" lines use `--status-completed`. "Does not go together" lines use `--destructive`. Colour is not the only difference: a "goes together" line is solid with a star at each end, and a "does not go together" line is dashed with a cross.
- Two series never overlap. When you release a series on a different series, it moves to the nearest free spot.
- A group is a named box around its member series. The box changes size to fit them.

## Do not

- Do not use purple gradients, glass, background blur, emoji as icons, a card in a card, pill shapes, or text that is all in the centre.
- Do not put a motif behind text. Use one motif or less on each view, but logged-out pages can have more.
- Do not add a font. Do not add shadows to flat surfaces.
- Do not add a colour token unless you check its contrast in the two themes.

## Check a change to the look

1. Run the validation run (see [development.md](development.md#validation-run)) for the pages that you changed.
2. Look at the screenshots in the light and dark themes, at 1440 px and 390 px.
3. For a large change, ask the review council. The `ui-council` skill tells you how.
