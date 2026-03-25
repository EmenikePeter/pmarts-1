// PMARTS Brand Colors
export const PMARTS = {
  primary: '#1A3D7C',      // Deep Blue
  secondary: '#F4C542',    // Pi Gold
  background: '#FFFFFF',
  surface: '#F8F9FA',
  text: '#1A1A1A',
  textSecondary: '#666666',
  success: '#22C55E',      // Green - Released
  warning: '#EAB308',      // Yellow - Held
  error: '#EF4444',        // Red - Disputed
  muted: '#9CA3AF',        // Gray - Expired
};

const tintColorLight = PMARTS.primary;
const tintColorDark = '#fff';

export default {
  light: {
    text: PMARTS.text,
    background: PMARTS.background,
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#fff',
    background: '#000',
    tint: tintColorDark,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorDark,
  },
};

