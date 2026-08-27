/**
 * Type-only stand-in for `@deepseek-ai/dsh-client-ui-slots`.
 * The standalone viewer renders components directly instead of through the
 * cordis slot system; only the locale typing survives.
 * @module shims/slots
 */

/** Merge-extensible locale namespace registry (augmented by locale modules). */
export interface LocaleNamespaceMap {}

/** Translate one namespaced dictionary key. */
export type TranslateNS<NS extends string> = (
  key: NS extends keyof LocaleNamespaceMap ? LocaleNamespaceMap[NS] : string,
) => string

/** Inject-face helper from the slot system; identity in the standalone viewer. */
export type InjectFace<T> = T

/** Locale prop share from the slot system. */
export interface PropsLocale<NS extends string> {
  t: TranslateNS<NS>
}
