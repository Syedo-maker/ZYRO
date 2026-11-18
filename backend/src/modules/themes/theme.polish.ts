import { contrast } from "./theme.contrast";
import { deriveTheme } from "./theme.tokens";
import type { Theme } from "./theme.schema";
import { themeService } from "./theme.service";

/**
 * "Finish and polish" in the Theme Studio (Store Themes, Part 2): a last check of the draft before the
 * owner publishes, with fixes applied to the draft and listed in plain words. Rules, not AI, so it is
 * free, instant and the same every time. It checks five things:
 *
 *   contrast     every colour pairing at WCAG AA (the contrast guard), and accents that disappear
 *   mobile       a headline long enough to fill a phone screen
 *   spacing      cards that cannot be told apart from the page
 *   fonts        a decorative pair on long text
 *   hierarchy    the hero first, and products always on the front page
 *
 * The fixed draft is saved as one step (Undo takes it back). Nothing is published.
 */

export interface PolishItem {
  area: "contrast" | "mobile" | "spacing" | "fonts" | "hierarchy";
  message: string;
}

export function polishTheme(input: Theme): { theme: Theme; fixes: PolishItem[]; notes: PolishItem[] } {
  let theme: Theme = structuredClone(input);
  const fixes: PolishItem[] = [];
  const notes: PolishItem[] = [];

  // Hierarchy: the hero opens the page when it is shown, and the products are always on it.
  const heroAt = theme.sections.findIndex((s) => s.id === "hero");
  if (theme.sections[heroAt]?.visible && heroAt > 0) {
    const [hero] = theme.sections.splice(heroAt, 1);
    theme.sections.unshift(hero);
    fixes.push({ area: "hierarchy", message: "Moved the hero to the top, so shoppers see your shop's name and message first." });
  }
  const featured = theme.sections.find((s) => s.id === "featured");
  if (featured && !featured.visible) {
    featured.visible = true;
    fixes.push({ area: "hierarchy", message: "Turned the New arrivals section back on, so your products are on the front page." });
  }

  // Spacing: flat cards on a flat page have no edge at all.
  if (theme.cardStyle === "flat" && theme.surfaceStyle === "flat") {
    theme.cardStyle = "bordered";
    fixes.push({ area: "spacing", message: "Gave cards a thin border: on a flat page, flat cards had no visible edge." });
  }

  // Contrast: an accent almost the same as the background reads as nothing.
  if (contrast(theme.colors.accent, theme.colors.background) < 1.5) {
    theme.colors.accent = theme.colors.primary;
    fixes.push({ area: "contrast", message: "Your accent colour almost matched the background, so accents now use your main colour." });
  }

  // Contrast: the guard, with its own plain-words corrections.
  const derived = deriveTheme(theme);
  theme = derived.theme;
  for (const c of derived.corrections) fixes.push({ area: "contrast", message: c.message });

  // Mobile: a long headline wraps into a wall on a phone. The owner's words are theirs, so only a note.
  if (theme.heroHeadline && theme.heroHeadline.length > 48) {
    notes.push({ area: "mobile", message: `Your headline is ${theme.heroHeadline.length} characters; under 48 reads best on a phone.` });
  }
  if (theme.aboutText && theme.aboutText.length > 450) {
    notes.push({ area: "mobile", message: "Your about text is long for a phone screen; a shorter one is more likely to be read." });
  }

  // Fonts: a display serif is lovely for headings, and tiring as the whole about text.
  if (theme.font === "dmsans-playfair" && (theme.aboutText?.length ?? 0) > 300) {
    notes.push({ area: "fonts", message: "Long text reads more easily in a plainer pair; consider Classic or Clean if your about text stays this long." });
  }

  return { theme, fixes, notes };
}

export const themePolish = {
  async run(storeId: string) {
    const draft = (await themeService.get(storeId)).draft;
    const { theme, fixes, notes } = polishTheme(draft);
    const state = fixes.length > 0 ? await themeService.saveDraft(storeId, theme) : await themeService.get(storeId);
    const checked = state.checks.length;
    return {
      fixes,
      notes,
      summary:
        fixes.length === 0
          ? `All good: ${checked} colour pairings pass AA, and the layout checks found nothing to fix.`
          : `Fixed ${fixes.length} ${fixes.length === 1 ? "thing" : "things"}. ${checked} colour pairings now pass AA. Nothing is live until you publish.`,
      state,
    };
  },
};
