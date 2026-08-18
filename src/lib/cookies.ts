export const REMEMBER_LOGIN_EMAIL_COOKIE = 'team-support-pro-remember-login-email'

export const readCookieValue = (name: string) => {
  if (typeof document === 'undefined') {
    return ''
  }

  const encodedName = `${name}=`
  const pair = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(encodedName))

  if (!pair) {
    return ''
  }

  return decodeURIComponent(pair.slice(encodedName.length))
}

export const setCookieValue = (name: string, value: string, days: number) => {
  if (typeof document === 'undefined') {
    return
  }

  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60))
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`
}

export const clearCookieValue = (name: string) => {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`
}
