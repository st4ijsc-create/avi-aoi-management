/**
 * StationDetail — industrial palettes, responsive constants & status maps.
 * MB11 decomposition (doc 27 §7 / doc 29 W8-D): moved verbatim from StationDetailScreen.tsx.
 */
import { Dimensions } from 'react-native';
import type { InspectionPointStatus } from '../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_WIDTH = Math.min(SCREEN_WIDTH * 0.88, 380);
const IS_TABLET = SCREEN_WIDTH >= 600; // 8 inch+ tablets

// Responsive marker sizing — scales up on larger screens (tablets / large phones)
const PCB_MARKER_SCALE = Math.min(Math.max(SCREEN_WIDTH / 400, 1), 1.8);
const MARKER_SIZE = Math.round(28 * PCB_MARKER_SCALE);
const MARKER_HALF = MARKER_SIZE / 2;
const MARKER_DOT_SIZE = Math.round(24 * PCB_MARKER_SCALE);
const MARKER_DOT_RADIUS = MARKER_DOT_SIZE / 2;
const MARKER_LABEL_FONT = Math.max(8, Math.round(8 * PCB_MARKER_SCALE));
const MARKER_HIT_SLOP = Math.round(8 * PCB_MARKER_SCALE);

// ============================================
// INDUSTRIAL PALETTES
// ============================================
const DK = {
  bg: '#0B1120',
  surface: '#131B2E',
  surfaceRaised: '#1A2540',
  surfaceHover: '#1E2D4A',
  border: '#1E2D4A',
  borderLight: '#263354',
  text: '#F0F4F8',
  textSecondary: '#8899B4',
  textMuted: '#54657A',
  accent: '#3B82F6',
  accentDark: '#2563EB',
  pass: '#22C55E',
  fail: '#EF4444',
  warn: '#F59E0B',
  gradient1: '#0F172A',
  gradient2: '#1E293B',
  overlay: 'rgba(11,17,32,0.35)',
  legendBg: 'rgba(11,17,32,0.85)',
};

type CP = typeof DK;

const LK: CP = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceRaised: '#F1F5F9',
  surfaceHover: '#E2E8F0',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',
  text: '#1E293B',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  accent: '#3B82F6',
  accentDark: '#2563EB',
  pass: '#22C55E',
  fail: '#EF4444',
  warn: '#F59E0B',
  gradient1: '#F8FAFC',
  gradient2: '#F1F5F9',
  overlay: 'rgba(255,255,255,0.25)',
  legendBg: 'rgba(255,255,255,0.90)',
};

// ============================================
// HELPERS
// ============================================
const STATUS_COLORS: Record<InspectionPointStatus, string> = {
  pass: DK.pass,
  fail: DK.fail,
  warn: DK.warn,
};

const STATUS_ICONS: Record<InspectionPointStatus, string> = {
  pass: 'check-circle',
  fail: 'close-circle',
  warn: 'alert-circle',
};

const STATUS_LABELS_VI: Record<InspectionPointStatus, string> = {
  pass: 'Đạt',
  fail: 'Lỗi',
  warn: 'Cảnh báo',
};

const STATUS_LABELS_EN: Record<InspectionPointStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  warn: 'Warning',
};

const STATUS_LABELS_ZH: Record<InspectionPointStatus, string> = {
  pass: '合格',
  fail: '不良',
  warn: '警告',
};

const PCB_HEIGHT = IS_TABLET ? Math.round(SCREEN_WIDTH * 0.55) : 400;

export {
  SCREEN_WIDTH, SCREEN_HEIGHT, PANEL_WIDTH, IS_TABLET,
  PCB_MARKER_SCALE, MARKER_SIZE, MARKER_HALF, MARKER_DOT_SIZE,
  MARKER_DOT_RADIUS, MARKER_LABEL_FONT, MARKER_HIT_SLOP, PCB_HEIGHT,
  DK, LK,
  STATUS_COLORS, STATUS_ICONS, STATUS_LABELS_VI, STATUS_LABELS_EN, STATUS_LABELS_ZH,
};
export type { CP };
