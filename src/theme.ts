import type { ThemeConfig } from './types'

export const defaultThemeConfig: ThemeConfig = {
  light: {
    appBg: '#f4f7fb',
    headerBg: '#0d2f4f',
    menuBg: '#123555',
    cardBg: '#ffffff',
    panelBg: '#fbfdff',
    inputBg: '#ffffff',
    buttonBg: '#0078d4',
    accent: '#0078d4',
    text: '#10243b',
    textMuted: '#5f7389',
    border: '#e5e7eb',
    buttonText: '#ffffff',
  },
  dark: {
    appBg: '#0b1621',
    headerBg: '#081422',
    menuBg: '#0d1d2e',
    cardBg: '#101d2b',
    panelBg: '#0f1a27',
    inputBg: '#102030',
    buttonBg: '#2d8cff',
    accent: '#5fa8ff',
    text: '#f2f7fb',
    textMuted: '#91a7bd',
    border: '#213447',
    buttonText: '#081422',
  },
}
