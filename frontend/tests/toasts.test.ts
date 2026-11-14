// The toast queue (src/lib/toasts.ts): toasts stack in order, the oldest gives way past the limit, a
// repeat replaces its copy, closing removes only that toast, and each tone has its time on screen.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addToast, MAX_TOASTS, removeToast, TOAST_DURATION_MS, type Toast, type ToastTone } from '../src/lib/toasts.ts'

let next = 0
const make = (message: string, tone: ToastTone = 'success'): Toast => ({ id: ++next, tone, message })

describe('stacking', () => {
  it('adds each toast after the ones already showing', () => {
    const list = addToast(addToast([], make('Product saved')), make('Order cancelled', 'info'))
    assert.deepEqual(
      list.map((t) => t.message),
      ['Product saved', 'Order cancelled'],
    )
  })

  it(`shows at most ${MAX_TOASTS}; a new one pushes out the oldest`, () => {
    let list: Toast[] = []
    for (const m of ['one', 'two', 'three', 'four', 'five']) list = addToast(list, make(m))
    assert.equal(list.length, MAX_TOASTS)
    assert.deepEqual(
      list.map((t) => t.message),
      ['two', 'three', 'four', 'five'],
    )
  })

  it('the same message and tone again replaces the earlier copy rather than stacking it', () => {
    const first = make('Product deleted')
    const again = make('Product deleted')
    const list = addToast(addToast(addToast([], first), make('Other')), again)
    assert.deepEqual(
      list.map((t) => t.id),
      [list[0].id, again.id],
    )
    assert.equal(list.filter((t) => t.message === 'Product deleted').length, 1)
  })

  it('the same words in a different tone are a different toast', () => {
    const list = addToast(addToast([], make('Saved', 'success')), make('Saved', 'warning'))
    assert.equal(list.length, 2)
  })

  it('does not change the list it was given', () => {
    const list = [make('a')]
    addToast(list, make('b'))
    assert.equal(list.length, 1)
  })
})

describe('closing', () => {
  it('removes only the closed toast', () => {
    const a = make('a')
    const b = make('b')
    const c = make('c')
    assert.deepEqual(
      removeToast([a, b, c], b.id).map((t) => t.message),
      ['a', 'c'],
    )
  })

  it('an unknown id changes nothing (a toast closed twice, by its timer and its button)', () => {
    const list = [make('a')]
    assert.deepEqual(removeToast(list, -1), list)
  })
})

describe('time on screen', () => {
  it('every tone stays 4 to 5 seconds, errors and warnings the longer', () => {
    for (const tone of ['success', 'error', 'warning', 'info'] as const) {
      assert.ok(TOAST_DURATION_MS[tone] >= 4000 && TOAST_DURATION_MS[tone] <= 5000, tone)
    }
    assert.ok(TOAST_DURATION_MS.error >= TOAST_DURATION_MS.success)
    assert.ok(TOAST_DURATION_MS.warning >= TOAST_DURATION_MS.info)
  })
})
