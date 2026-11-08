# TODO: v2-4 search (council round 2, 2 of 5 passed)

Branch `feat/v2-4-search`, PR #18, minikube tags `9411672-search1` (api) and `3b1c31e-search2` (web). Spec: `PRD/V2_4_SEARCH.md`.
Animations and cleanliness passed. The items below are from the three members that failed, most important first.

## Bugs

- [x] **Added series stack on top of each other in crowded areas** (UI design). `placeInGroup` in
  `apps/web/src/lib/canvas-layout.ts` calls `nearestFree`, which returns `start` (an occupied spot) when
  nothing within `MAX_RADIUS` is free. In a dense grid the padded group box always hits neighbouring rows,
  so every added member lands on the same spot. Never return an occupied spot: fall back to the nearest
  spot with no bubble (letting the box overlap), or refuse the add with "No room next to this group; move
  series apart first". Add a unit test for the dense case.
- [ ] **Mouse picks don't move focus in Safari or Firefox on macOS** (code review). The side card guesses a
  pick from `document.activeElement?.closest('.react-flow__panel li')`, and clicking a button there doesn't
  focus it. Pass the pick explicitly: `onFocus(seriesId, picked)`, sending `false` from `onResults` and `true`
  from `onPick` (`constellations-card.tsx`, `recommendation-canvas.tsx`), then remove the guess and its
  `shortcut:` comment.
- [ ] **Phone pick lands above centre** (code review). `onPick` calls `onFocus` before `toggle(false)`, so the
  `[data-map-card]` offset uses a card that is about to close. With the flag above, skip the offset when
  `picked && compact`.

## Keyboard focus (user experience)

- [ ] After a pick in "Link to…", the line-type step ("Goes together" / "Doesn't go together") leaves
  focus on nothing. Focus its first item when the menu switches to `type: 'connect'`
  (`recommendation-canvas.tsx`).
- [ ] After "Delete group" from the keyboard, focus is lost because the group's handle is gone. Move focus
  to the first former member's bubble.

## Tests

- [ ] `apps/api/src/routes/canvas.test.ts`: cover the locking in `joinGroup` with `Promise.all`:
  - crossing moves (S1 from G1 to G2 while S2 goes from G2 to G1);
  - two moves at once of a group's only member.

  Assert every call returns 204 (no deadlock 500), each series has one membership, and an emptied group
  is deleted.

## Polish

- [ ] A long group name wraps the "Add to <group>" label in the add step onto two tightly spaced lines.
  Use "Add series" with the name truncated, or `leading-snug`.

## Known, not raised as failures

- Two first joins at once of an ungrouped series can leave an empty, hidden group behind.
- `nearestFree`'s worst case on a fully crowded drop is about 50k samples × N footprints (about 180 ms at
  1000 series and 540 ms at 3000, when a group member is dropped far from its group).
- Adding to a group saves the membership and the position in two requests, not one transaction.
- On a phone with many results open, the highlighted match's title can sit behind the legend.
- When a series joins a group, the box snaps to its new size while the series slides in.
