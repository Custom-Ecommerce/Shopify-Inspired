/** Design tokens of both apps. English UI, phones of 360 to 412 dp, nothing tappable under 44 dp. */
export const colors = {
  background: '#f6f7f9',
  surface: '#ffffff',
  border: '#d9dee5',
  text: '#111827',
  textMuted: '#4b5563',
  primary: '#0f6b4f',
  onPrimary: '#ffffff',
  danger: '#b42318',
  warning: '#8a5300',
  warningSurface: '#fff4e0',
  success: '#1a7f37',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;
export const fontSize = { caption: 13, body: 16, title: 18, heading: 22 } as const;

export const MIN_TAP_TARGET = 44;
export const MIN_SCREEN_WIDTH = 360;
