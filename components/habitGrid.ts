/**
 * The geometry of the seven-column date grids (week row, month calendar, weekday chooser), in one
 * place so that the arithmetic below and the styles cannot drift apart.
 *
 * A seven-column grid on a phone cannot give every cell a 44pt-wide target with ordinary card
 * padding and gaps. Two things are done instead, both from the approved "minimise gaps and padding":
 *
 *  - the grid bleeds `GRID_BLEED` into the card's own padding (a negative horizontal margin), and
 *  - the TAP AREA is the whole column: there is no gap between Pressables, and the visible gap between
 *    cells is drawn inside each one (`CELL_INSET` on every side).
 *
 * Height is simply `MIN_TARGET`. Width is whatever the screen leaves, see `columnWidth`.
 */
export const MIN_TARGET = 44;
export const GRID_COLUMNS = 7;
export const GRID_BLEED = 8;
export const CELL_INSET = 1;

/** Widths the grids sit inside, taken from the layout they are used in. */
export const SCREEN_PADDING = 16; // sharedStyles.formContainer / formContainerScroll
export const CARD_BORDER = 1; // components/Card
export const CARD_PADDING = 16; // components/Card

/** Width in pt of one column's tap area on a screen `screenWidth` points wide. */
export function columnWidth(screenWidth: number): number {
  const cardInner = screenWidth - 2 * SCREEN_PADDING - 2 * CARD_BORDER - 2 * CARD_PADDING;
  return (cardInner + 2 * GRID_BLEED) / GRID_COLUMNS;
}

/** The narrowest screen on which every column is at least `MIN_TARGET` wide. */
export const NARROWEST_FULL_TARGET_SCREEN = Math.ceil(
  MIN_TARGET * GRID_COLUMNS - 2 * GRID_BLEED + 2 * SCREEN_PADDING + 2 * CARD_BORDER + 2 * CARD_PADDING,
);
