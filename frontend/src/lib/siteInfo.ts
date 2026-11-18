import { apiFetch } from './apiClient'

let demoOnly: Promise<boolean> | null = null

/** Whether this deployment keeps uploads on a temporary disk. Asked once per visit; no answer means no. */
export function uploadsAreDemoOnly(): Promise<boolean> {
  demoOnly ??= apiFetch<{ uploadsDemoOnly: boolean }>('/site').then(
    (site) => site.uploadsDemoOnly === true,
    () => false,
  )
  return demoOnly
}
