export const appConfig = {
  appName: import.meta.env.VITE_APP_NAME || 'TeamSupportPro',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  appVersion: __APP_VERSION__,
} as const

export const apiUrl = (path: string) => `${appConfig.apiBaseUrl}${path}`