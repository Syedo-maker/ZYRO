/**
 * Store Themes (2026-11): the strict theme schema, the contrast guard, the token map and the presets,
 * on their own. The guard is tested the strong way too: many random colour choices, and every pairing
 * the storefront uses must come out at WCAG AA or better.
 */
import { contrast, ensureContrast, mix, textOn } from "../../src/modules/themes/theme.contrast";
import { deriveTheme, TOKEN_NAMES } from "../../src/modules/themes/theme.tokens";
import { PRESETS, defaultThemeFor } from "../../src/modules/themes/theme.presets";
import { themeSchema, type Theme } from "../../src/modules/themes/theme.schema";
import { FONT_PAIR_IDS } from "../../src/modules/themes/theme.fonts";

const valid = (): Theme => structuredClone(PRESETS["clean-light"].theme);
const uuid = "123e4567-e89b-12d3-a456-426614174000";
const storeImage = (store = "store1") => `http://localhost:5000/uploads/products/${store}/${uuid}.png`;

describe("the theme schema", () => {
  it("accepts every preset", () => {
    for (const p of Object.values(PRESETS)) expect(themeSchema.safeParse(p.theme).success).toBe(true);
  });

  it.each([
    ["a colour that is not six-digit hex", (t: any) => (t.colors.primary = "red")],
    ["a colour with CSS in it", (t: any) => (t.colors.background = "#fff; background:url(x)")],
    ["a font outside the list", (t: any) => (t.font = "Comic Sans")],
    ["an unknown section", (t: any) => (t.sections[0] = { id: "script", visible: true })],
    ["a section twice", (t: any) => (t.sections[1] = { ...t.sections[0] })],
    ["a missing section", (t: any) => t.sections.pop()],
    ["an unknown button style", (t: any) => (t.buttonStyle = "blob")],
    ["an extra key (raw CSS)", (t: any) => (t.css = "body{display:none}")],
    ["an extra key inside colours", (t: any) => (t.colors.link = "#000000")],
    ["HTML in a headline", (t: any) => (t.heroHeadline = "<script>alert(1)</script>")],
    ["a headline over 80 characters", (t: any) => (t.heroHeadline = "x".repeat(81))],
    ["an about text over 600 characters", (t: any) => (t.aboutText = "x".repeat(601))],
    ["a logo from another website", (t: any) => (t.logoUrl = "https://evil.example.com/logo.png")],
    ["a javascript: logo", (t: any) => (t.logoUrl = "javascript:alert(1)")],
    ["an SVG logo", (t: any) => (t.logoUrl = `http://localhost:5000/uploads/products/store1/${uuid}.svg`)],
    ["a logo from the private area", (t: any) => (t.logoUrl = `http://localhost:5000/uploads/receipts/store1/${uuid}.png`)],
    ["a wrong version", (t: any) => (t.version = 2)],
  ])("rejects %s", (_label, change) => {
    const t = valid() as any;
    change(t);
    expect(themeSchema.safeParse(t).success).toBe(false);
  });

  it("accepts an image uploaded to the store, and lowercases colours", () => {
    const t = valid();
    t.logoUrl = storeImage();
    t.colors.primary = "#ABCDEF";
    const parsed = themeSchema.parse(t);
    expect(parsed.colors.primary).toBe("#abcdef");
  });

  it("offers six font pairs", () => {
    expect(FONT_PAIR_IDS).toHaveLength(6);
  });
});

describe("the colour arithmetic", () => {
  it("measures contrast like WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("text on any fill is black or white, and always at least 4.5:1", () => {
    for (let i = 0; i < 300; i++) {
      const fill = randomColour();
      expect(contrast(textOn(fill), fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves a colour that already passes exactly as it is", () => {
    expect(ensureContrast("#111827", ["#ffffff"], 4.5)).toBe("#111827");
  });

  it("moves a failing colour only as far as needed", () => {
    const fixed = ensureContrast("#9ca3af", ["#ffffff"], 4.5);
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fixed, "#ffffff")).toBeLessThan(5.5);
  });
});

describe("the contrast guard", () => {
  it("every preset passes untouched: no corrections, every pairing at AA", () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      const d = deriveTheme(p.theme);
      expect({ id, corrections: d.corrections }).toEqual({ id, corrections: [] });
      for (const c of d.checks) expect({ id, pair: c.pair, ok: c.ratio >= c.min }).toEqual({ id, pair: c.pair, ok: true });
    }
  });

  it("corrects unreadable text and says so", () => {
    const t = valid();
    t.colors.text = "#f2f2f2"; // almost white on white
    const d = deriveTheme(t);
    expect(d.corrections.map((c) => c.field)).toContain("text");
    expect(d.corrections.find((c) => c.field === "text")!.message).toMatch(/changed to #[0-9a-f]{6}/);
    expect(contrast(d.theme.colors.text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a light button colour for buttons, with dark text on them, but darkens it for links", () => {
    const t = valid();
    t.colors.primary = "#ffe66d"; // a light yellow on white
    const d = deriveTheme(t);
    expect(d.tokens["--color-brand"]).toBe("#ffe66d");
    expect(d.tokens["--color-on-brand"]).toBe("#000000");
    expect(contrast(d.tokens["--color-brand-ink"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(d.corrections.find((c) => c.field === "primary")?.message).toMatch(/Buttons keep #ffe66d/);
  });

  it("holds for 400 random colour choices and every style: every pairing at AA, input borders at 3:1", () => {
    const styles = ["flat", "raised", "contrast"] as const;
    const cards = ["flat", "bordered", "shadow"] as const;
    for (let i = 0; i < 400; i++) {
      const t = valid();
      t.colors = { primary: randomColour(), accent: randomColour(), background: randomColour(), text: randomColour() };
      t.surfaceStyle = styles[i % 3];
      t.cardStyle = cards[(i >> 1) % 3];
      const d = deriveTheme(t);
      for (const c of d.checks) {
        if (c.ratio < c.min) throw new Error(`${c.pair} ${c.ratio} < ${c.min} for ${JSON.stringify(t.colors)}`);
      }
    }
  });
});

describe("the token map", () => {
  it("sets only allowlisted custom properties, with plain values", () => {
    const d = deriveTheme(valid());
    expect(Object.keys(d.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
    for (const [name, value] of Object.entries(d.tokens)) {
      expect(name).toMatch(/^(--[a-z0-9-]+|color-scheme)$/);
      expect(value).not.toMatch(/[;{}<>]|url\(|expression|javascript/i);
    }
  });

  it("maps the button style to the button radius", () => {
    const t = valid();
    t.buttonStyle = "pill";
    expect(deriveTheme(t).tokens["--radius-button"]).toBe("9999px");
    t.buttonStyle = "square";
    expect(deriveTheme(t).tokens["--radius-button"]).toBe("0.125rem");
  });

  it("uses only the chosen pair's families", () => {
    const t = valid();
    t.font = "dmsans-playfair";
    const d = deriveTheme(t);
    expect(d.tokens["--font-sans"]).toMatch(/^"DM Sans"/);
    expect(d.tokens["--font-display"]).toMatch(/^"Playfair Display"/);
  });
});

describe("a store's default theme", () => {
  it("is Dark Lime wearing the store's existing colour", () => {
    expect(defaultThemeFor({ themeColor: "#0B3B33" }).colors.primary).toBe("#0b3b33");
    expect(defaultThemeFor({ themeColor: null })).toEqual(PRESETS["dark-lime"].theme);
  });
});

function randomColour(): string {
  return "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
}
void mix;
