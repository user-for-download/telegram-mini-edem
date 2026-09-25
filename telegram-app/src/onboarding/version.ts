/** Bump when the legal copy or first-login experience changes. */
export const ONBOARDING_VERSION = "3";

export function shouldShowOnboarding(
  completedVersion: string | null | undefined,
): boolean {
  return completedVersion !== ONBOARDING_VERSION;
}
