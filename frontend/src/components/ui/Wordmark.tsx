/**
 * The ZYRO wordmark, the same everywhere it appears: the landing page, the dashboard sidebar, the
 * register and the footer.
 *
 * It used to be typed out separately in each place, at different weights, so the product looked
 * like three slightly different products. Size and colour come from the caller through `className`,
 * because the wordmark sits on both dark and light surfaces; the typeface, weight and tracking do not
 * vary.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`font-display font-extrabold tracking-tight ${className}`}>ZYRO</span>
}
