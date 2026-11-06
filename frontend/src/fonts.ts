/*
 * The typefaces, served from ZYRO's own origin rather than fetched from Google Fonts.
 *
 * They used to arrive through an `@import` of fonts.googleapis.com at the top of index.css. That
 * made every page's styling wait on a third-party server: when Google Fonts was slow to answer,
 * which happened from this development machine and happens on some Pakistani networks, the whole
 * app sat unstyled, and every visit also told Google who was looking. Bundled through Vite, the font
 * files are hashed, cached for good, and delivered by the same CDN as the rest of the app.
 *
 * Each file pulls in one weight and lists every script subset with a `unicode-range`, so a browser
 * only downloads the subsets a page actually uses. Only the weights the interface uses are imported:
 * adding one here is a deliberate choice, because each is another file a visitor may download.
 *
 * The family names are the same as Google's ("Plus Jakarta Sans" and so on), so the `--font-*` tokens in
 * index.css did not have to change.
 *
 * Both families are licensed under the SIL Open Font License 1.1, which permits commercial use.
 */

// Body and interface text: Plus Jakarta Sans, the same family as the headings, so the platform reads
// as one voice from the landing page to the register.
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'

// Display: Instrument Serif, italic, for the big headlines and the one highlighted word in them
// (the landing page, sign-in, a storefront's hero). It has a single weight, so it is never bolded.
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
