import type { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { Wordmark } from './Wordmark'

/**
 * The frame every sign-in and sign-up page shares (the owner's, the register's): the black page with
 * a soft lime glow behind a centred card, the wordmark at the top of the card. One frame, so signing in
 * looks the same wherever it happens.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-18rem] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]"
      />
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="relative flex w-full max-w-md flex-col gap-6 rounded-3xl border border-border bg-surface/90 p-8 shadow-lg backdrop-blur sm:p-10">
        <Wordmark className="text-2xl text-text" />
        {children}
      </div>
    </div>
  )
}

/** The page's heading, in the display serif. */
export const AUTH_TITLE = 'font-serif text-h2 font-normal italic leading-tight'
/** A link inside the card ("Create one", "Log in"). */
export const AUTH_LINK = 'font-semibold text-brand-ink underline-offset-4 hover:underline'
