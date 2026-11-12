import { z } from "zod";
import { FONT_PAIR_IDS } from "./theme.fonts";

/**
 * A store theme, strictly (Store Themes, 2026-11). This is the only shape a theme is ever stored or
 * served in, whoever wrote it: the owner's controls, a preset, or (Part 2) the AI. Colours are hex,
 * every style is a fixed choice, sections come from a fixed list, texts and image links are capped,
 * and unknown keys are refused rather than ignored, so no CSS, HTML or code can ride along.
 */

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours are six-digit hex values such as #1A2B3C")
  .transform((v) => v.toLowerCase());

/** Plain text a shopper will read: one line, no markup characters. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !/[<>{}]/.test(v), "Text cannot contain < > { or }")
    .nullable();

export const SECTION_IDS = ["hero", "featured", "categories", "reviews", "about"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const RADIUS_SIZES = ["none", "small", "medium", "large"] as const;
export const BUTTON_STYLES = ["pill", "rounded", "square"] as const;
export const CARD_STYLES = ["flat", "bordered", "shadow"] as const;
export const SURFACE_STYLES = ["flat", "raised", "contrast"] as const;
export const FOOTER_STYLES = ["simple", "detailed", "minimal"] as const;

/**
 * A logo or banner must be an image uploaded to this store's own storage (the product image upload,
 * which accepts only JPEG, PNG or WebP, checked by their bytes, so never SVG). Checked against the
 * store in theme.service.ts; here only the shape: an http(s) link ending in one of our image keys.
 */
export const IMAGE_KEY_TAIL = /\/products\/([A-Za-z0-9_-]{1,64})\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s"'<>]+$/, "Images must be uploaded to this store")
  .refine((v) => IMAGE_KEY_TAIL.test(v), "Images must be uploaded to this store")
  .nullable();

export const themeSchema = z
  .object({
    version: z.literal(1),
    /** The preset it started from, for the owner's own reference. */
    preset: z.string().trim().max(40).nullable(),
    colors: z
      .object({
        primary: hex,
        accent: hex,
        background: hex,
        text: hex,
      })
      .strict(),
    surfaceStyle: z.enum(SURFACE_STYLES),
    font: z.enum(FONT_PAIR_IDS),
    radius: z.enum(RADIUS_SIZES),
    buttonStyle: z.enum(BUTTON_STYLES),
    cardStyle: z.enum(CARD_STYLES),
    logoUrl: imageUrl,
    bannerUrl: imageUrl,
    sections: z
      .array(z.object({ id: z.enum(SECTION_IDS), visible: z.boolean() }).strict())
      .length(SECTION_IDS.length, "List every homepage section once")
      .refine((list) => new Set(list.map((s) => s.id)).size === list.length, "Each homepage section may appear only once"),
    footerStyle: z.enum(FOOTER_STYLES),
    heroHeadline: plainText(80),
    heroText: plainText(200),
    aboutText: plainText(600),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;
