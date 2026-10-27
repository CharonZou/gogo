import { describe, expect, it } from 'vitest'
import { GOGO_INTRO_SELF_LABEL, GOGO_INTRO_SELF_PROMPT } from '../src/lib/GOGO-intro-prompt.js'

describe('GOGO-intro-prompt', () => {
  it('uses intro label and formal self-intro prompt', () => {
    expect(GOGO_INTRO_SELF_LABEL).toBe('介绍一下自己~')
    expect(GOGO_INTRO_SELF_PROMPT).toContain('正式、清晰地介绍')
    expect(GOGO_INTRO_SELF_PROMPT).toContain('https://www.charonzou.com/')
  })
})
