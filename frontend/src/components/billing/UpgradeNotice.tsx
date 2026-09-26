import { Link } from 'react-router-dom'
import { ApiError } from '../../lib/apiClient'
import { upgradeHintOf } from '../../lib/billingApi'

const linkClass = 'font-semibold text-brand hover:text-brand-hover'

/**
 * What to show instead of a bare error when a plan limit or the monthly AI allowance is reached
 * (a 402 from the server): what the limit is, and the next step: the plan that lifts it, or an AI
 * pack when the allowance is what ran out. Only the store owner can buy, so staff are told to ask
 * the owner instead of being sent to a page they cannot open.
 */
export function UpgradeNotice({ error, isOwner = true }: { error: unknown; isOwner?: boolean }) {
  const hint = upgradeHintOf(error)
  if (!hint || !(error instanceof ApiError)) return null
  const aiAllowance = hint.feature === 'ai_generations' || hint.feature === 'ai_chat_messages'

  return (
    <div role="status" className="rounded-[10px] border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-text">
      <p className="font-semibold">{error.detail ?? error.message}</p>
      <p className="mt-1.5 text-text-secondary">
        {!isOwner && 'Ask the store owner to upgrade the plan.'}
        {isOwner && hint.requiredPlan && (
          <>
            <Link to="/admin/billing" className={linkClass}>
              Upgrade to {hint.requiredPlan}
            </Link>{' '}
            to lift this limit{aiAllowance ? ', or ' : '.'}
          </>
        )}
        {isOwner && aiAllowance && (
          <>
            {!hint.requiredPlan && 'You can '}
            <Link to="/admin/billing" className={linkClass}>
              buy an AI pack
            </Link>{' '}
            for extra credits that do not expire at month end.
          </>
        )}
        {isOwner && !hint.requiredPlan && !aiAllowance && 'This is the highest limit available.'}
      </p>
    </div>
  )
}
