// @vitest-environment jsdom
import { revealFirstInvalidField } from '@/utils/formValidation'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let form: HTMLFormElement

beforeEach(() => {
  form = document.createElement('form')
  form.noValidate = true
  document.body.appendChild(form)
})

afterEach(() => {
  form.remove()
})

/** The real-world shape from the BYOK modals: invalid number input inside a fieldset inside a collapsed details. */
function appendDetailsWithInvalidInput(): { details: HTMLDetailsElement; input: HTMLInputElement } {
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = 'Inference parameters'
  const fieldset = document.createElement('fieldset')
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.max = '99'
  input.value = '500' // rangeOverflow
  fieldset.appendChild(input)
  details.appendChild(summary)
  details.appendChild(fieldset)
  form.appendChild(details)
  return { details, input }
}

describe('revealFirstInvalidField (R2/R9 regression)', () => {
  it('returns null for a valid form', () => {
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.max = '99'
    input.value = '50'
    form.appendChild(input)

    expect(revealFirstInvalidField(form)).toBeNull()
  })

  it('focuses the invalid control itself, not its fieldset, and returns its own message (R2)', () => {
    const { input } = appendDetailsWithInvalidInput()
    // Precondition: the fieldset also matches :invalid and precedes the input in document order,
    // which is exactly what a bare `:invalid` selector used to return.
    expect(form.querySelector(':invalid')?.tagName).toBe('FIELDSET')

    const message = revealFirstInvalidField(form)
    expect(message).toBe(input.validationMessage)
    expect(message).not.toBe('')
    expect(message).not.toBe('Please review the highlighted fields.')
    expect(document.activeElement).toBe(input)
  })

  it('opens the collapsed <details> hiding the invalid control', () => {
    const { details } = appendDetailsWithInvalidInput()
    expect(details.open).toBe(false)

    revealFirstInvalidField(form)

    expect(details.open).toBe(true)
  })

  it('handles an invalid control outside any <details>', () => {
    const input = document.createElement('input')
    input.required = true
    form.appendChild(input)

    const message = revealFirstInvalidField(form)

    expect(message).toBe(input.validationMessage)
    expect(document.activeElement).toBe(input)
  })

  it('reports the first invalid control in document order', () => {
    const first = document.createElement('input')
    first.required = true
    const second = document.createElement('input')
    second.required = true
    form.appendChild(first)
    form.appendChild(second)

    revealFirstInvalidField(form)

    expect(document.activeElement).toBe(first)
  })
})
