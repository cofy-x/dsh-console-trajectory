import { describe, expect, it } from 'vitest'
import { sanitizedEnvironment } from '../src/browser.js'

describe('sanitizedEnvironment', () => {
  it('removes credential-like variables without changing ordinary values', () => {
    expect(sanitizedEnvironment({
      PATH: '/bin',
      DEEPSEEK_API_KEY: 'secret',
      ACCESS_TOKEN: 'token',
      EDITOR: 'vim',
    })).toEqual({ PATH: '/bin', EDITOR: 'vim' })
  })
})
