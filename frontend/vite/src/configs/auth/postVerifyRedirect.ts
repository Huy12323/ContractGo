// Shared localStorage key for the post-email-verification redirect destination.
// Written by App_SignUpForm on signup; read by Page_VerifyEmail after successful
// token verification. Acts as a cross-tab fallback when the user opens the
// verification email in a different tab than the one they signed up in
// (in which case the URL's `?redirect=` query param is lost).
export const POST_VERIFY_REDIRECT_KEY = 'auth_redirect_after_verify'

export const consumePostVerifyRedirect = (): string | null => {
    const value = localStorage.getItem(POST_VERIFY_REDIRECT_KEY)
    if (value) localStorage.removeItem(POST_VERIFY_REDIRECT_KEY)
    return value
}
