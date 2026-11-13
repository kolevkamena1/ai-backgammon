/**
 * Makes native constraint-validation failures visible even when the offending control is hidden
 * inside a collapsed `<details>`.
 *
 * The browser refuses to submit a form with an invalid control, but it cannot show a validation
 * bubble for a control that is not rendered (collapsed `<details>`), so the submit silently does
 * nothing. Forms that use this helper set `noValidate` and call it from `onSubmit`; it opens the
 * first invalid control's nearest collapsed `<details>`, focuses the control, and returns its
 * validation message so the caller can render an inline alert. Returns `null` when the form is valid.
 */
export function revealFirstInvalidField(form: HTMLFormElement): string | null {
  if (form.checkValidity()) {
    return null
  }

  type ValidatableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  // Controls only: a bare `:invalid` also matches the ancestor `<fieldset>` (and the form itself),
  // which precedes its children in document order. Focusing a fieldset is a no-op and its
  // `validationMessage` is empty, which silently degraded the alert to the generic fallback (R2).
  const invalid = form.querySelector<ValidatableControl>('input:invalid, select:invalid, textarea:invalid')
  if (invalid === null) {
    return form.validationMessage || 'Please review the highlighted fields.'
  }

  const details = invalid.closest('details')
  if (details !== null && !details.open) {
    details.open = true
  }
  // Focus only after the details is open so the control is rendered and focusable.
  invalid.focus()

  return invalid.validationMessage || 'Please review the highlighted fields.'
}