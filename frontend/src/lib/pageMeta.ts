import { useEffect } from 'react'

export interface PageMeta {
  /** The browser tab and the search result's headline. */
  title: string
  /** The search result's snippet, and the text of a shared link's preview. */
  description: string
  /** og:type: "website" for a page about the platform, "product" for a product. */
  type?: 'website' | 'product'
  /** An absolute or root-relative image URL for link previews. */
  image?: string
}

/** Search engines show about 160 characters of a description; a longer one is cut at a word. */
export function clampDescription(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`
}

/**
 * Gives the page its own title and description (and the Open Graph and Twitter tags of a link
 * preview) while it is shown. ZYRO is a single-page app, so index.html's tags are shared by every
 * page: each tag is put back the way it was, or removed if this page added it, when the page goes
 * or its details change. Pass null while there is nothing to describe yet (a page still loading),
 * and the shared tags are left alone.
 *
 * Google runs the page's script before reading it, so it sees these. A link preview on WhatsApp or
 * Facebook reads the HTML as sent, before any script, so it still shows index.html's tags.
 */
export function usePageMeta(meta: PageMeta | null) {
  const title = meta?.title
  const description = meta?.description
  const type = meta?.type ?? 'website'
  const image = meta?.image

  useEffect(() => {
    if (title === undefined || description === undefined) return
    const previousTitle = document.title
    document.title = title

    const restore: (() => void)[] = []
    const set = (attr: 'name' | 'property', key: string, content: string) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
      if (existing) {
        const before = existing.content
        existing.content = content
        restore.push(() => {
          existing.content = before
        })
        return
      }
      const tag = document.createElement('meta')
      tag.setAttribute(attr, key)
      tag.content = content
      document.head.appendChild(tag)
      restore.push(() => tag.remove())
    }

    set('name', 'description', description)
    set('property', 'og:title', title)
    set('property', 'og:description', description)
    set('property', 'og:type', type)
    if (image) set('property', 'og:image', new URL(image, window.location.origin).href)
    set('name', 'twitter:card', image ? 'summary_large_image' : 'summary')

    return () => {
      document.title = previousTitle
      for (const undo of restore.reverse()) undo()
    }
  }, [title, description, type, image])
}
