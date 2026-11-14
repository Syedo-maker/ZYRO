// The web container's nginx config (nginx/default.conf.template): the access log must never record a
// query string or a referer, because a password-reset link carries its token in the query string and
// the reset page's asset requests carry that URL as their referer (audit 2026-11). Checked live once
// with the repository's templates in a local nginx container: no token in the log after the fix.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const conf = readFileSync(new URL('../nginx/default.conf.template', import.meta.url), 'utf8').replace(/#.*$/gm, '')

describe('the web access log', () => {
  it('uses the query-free format for the whole server', () => {
    assert.match(conf, /server\s*\{[\s\S]*access_log\s+\S+\s+zyro_noquery\s*;/)
  })

  it('the format records the path only: no full request line, query, arguments or referer', () => {
    const format = /log_format\s+zyro_noquery\s+'([^']*)'/.exec(conf)?.[1]
    assert.ok(format, 'zyro_noquery format exists')
    for (const leaky of ['$request ', '$request"', '$request_uri', '$args', '$query_string', '$http_referer', '$arg_']) {
      assert.ok(!format.includes(leaky), `format must not log ${leaky.trim()}`)
    }
    assert.match(conf, /map\s+\$request_uri\s+\$zyro_path/)
  })

  it('no location turns the default (query-logging) format back on', () => {
    for (const m of conf.matchAll(/access_log\s+([^;]+);/g)) {
      const value = m[1].trim()
      assert.ok(value === 'off' || value.endsWith('zyro_noquery'), `access_log ${value}`)
    }
  })
})
