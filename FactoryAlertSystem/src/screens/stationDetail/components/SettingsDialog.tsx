/**
 * StationDetail — 2-tab settings dialog (station-detail options + floating-panel sections).
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../context';
import { useSettingsStore } from '../../../store';
import SettingItem from '../../../components/SettingItem';
import type { CanvasImageMode, FloatingPanelSections } from '../../../types';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';

// ============================================
// STATION DETAIL SETTINGS DIALOG (2-tab)
// ============================================
const StationDetailSettingsDialog: React.FC<{
  visible: boolean;
  onClose: () => void;
  t: typeof STATION_T.vi;
}> = ({ visible, onClose, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const settings = useSettingsStore((s) => s.settings);
  const updateAppSettings = useSettingsStore((s) => s.updateAppSettings);
  const updateNotificationConfig = useSettingsStore((s) => s.updateNotificationConfig);
  const [activeTab, setActiveTab] = useState<0 | 1>(0);

  const handlePanelSectionToggle = useCallback(
    (section: keyof FloatingPanelSections, value: boolean) => {
      const current = settings.notifications.floatingPanelSections || {
        statistics: true, trend: true, defects: true, captures: true, measurements: true, events: true,
      };
      updateNotificationConfig({
        floatingPanelSections: { ...current, [section]: value },
      });
    },
    [settings.notifications.floatingPanelSections, updateNotificationConfig],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          width: '90%',
          maxWidth: 500,
          height: '75%',
          backgroundColor: C.surface,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.border,
        }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Icon name="cog" size={20} color={C.accent} />
            <Text style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: '700', color: C.text }}>{t.settingsDialogTitle}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={20} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          {/* Tabs */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border }}>
            {[t.tabStationDetail, t.tabFloatingPanel].map((label, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => setActiveTab(idx as 0 | 1)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: 'center',
                  borderBottomWidth: 2,
                  borderBottomColor: activeTab === idx ? C.accent : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: activeTab === idx ? '700' : '500', color: activeTab === idx ? C.accent : C.textMuted }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Content */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
            {activeTab === 0 ? (
              <>
                {/* Canvas Image Mode */}
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: C.surface,
                }}>
                  <Icon name="image-size-select-large" size={20} color={C.textSecondary} />
                  <Text style={{ flex: 1, marginLeft: 12, fontSize: 13, color: C.text, fontWeight: '500' }}>{t.canvasImageMode}</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {(['fit', 'fill', 'cover'] as const).map((mode) => {
                      const currentMode = (settings.app.canvasImageMode ?? 'fit') as CanvasImageMode;
                      const label = mode === 'fit' ? t.canvasImageModeFit : mode === 'fill' ? t.canvasImageModeFill : t.canvasImageModeCover;
                      const iconName = mode === 'fit' ? 'fit-to-screen-outline' : mode === 'fill' ? 'arrow-expand-all' : 'crop';
                      return (
                        <TouchableOpacity
                          key={mode}
                          onPress={() => updateAppSettings({ canvasImageMode: mode })}
                          style={{
                            flexDirection: 'row', alignItems: 'center',
                            paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20,
                            backgroundColor: currentMode === mode ? `${C.accent}20` : 'transparent',
                            borderWidth: currentMode === mode ? 1 : 0, borderColor: C.accent, gap: 3,
                          }}>
                          <Icon name={iconName} size={14} color={currentMode === mode ? C.accent : C.textMuted} />
                          <Text style={{ fontSize: 11, fontWeight: currentMode === mode ? '600' : '400', color: currentMode === mode ? C.accent : C.textMuted }}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Filter points by workstation toggle */}
                {settings.app.workstationId != null && (
                  <SettingItem
                    icon="filter-variant"
                    title={t.filterPointsByWorkstation}
                    subtitle={t.filterPointsByWorkstationDesc}
                    type="switch"
                    switchValue={settings.app.filterPointsByWorkstation ?? false}
                    onSwitchChange={(v) => updateAppSettings({ filterPointsByWorkstation: v })}
                  />
                )}

                {/* Slow network mode toggle */}
                <SettingItem
                  icon="turtle"
                  title={t.slowNetworkMode}
                  subtitle={t.slowNetworkModeDesc}
                  type="switch"
                  switchValue={settings.app.slowNetworkMode ?? false}
                  onSwitchChange={(v) => updateAppSettings({ slowNetworkMode: v })}
                />

                <SettingItem
                  icon="update"
                  title={t.proactivePolling}
                  subtitle={t.proactivePollingDesc}
                  type="switch"
                  switchValue={settings.app.proactivePollingEnabled ?? false}
                  onSwitchChange={(v) => updateAppSettings({ proactivePollingEnabled: v })}
                />
                {settings.app.proactivePollingEnabled && (
                  <SettingItem
                    icon="timer-outline"
                    title={t.proactivePollingInterval}
                    value={`${settings.app.proactivePollingIntervalSec ?? 60}s`}
                    type="navigate"
                    onPress={() => {
                      const current = settings.app.proactivePollingIntervalSec ?? 60;
                      const options = [15, 30, 45, 60, 90, 120, 180, 300];
                      const nextIdx = (options.indexOf(current) + 1) % options.length;
                      updateAppSettings({ proactivePollingIntervalSec: options[nextIdx >= 0 ? nextIdx : 0] });
                    }}
                  />
                )}
                <SettingItem
                  icon="timer-outline"
                  title={t.ngFlashDuration}
                  subtitle={t.ngFlashDurationDesc}
                  value={`${Math.round((settings.app.ngFlashDurationMs || 5000) / 1000)}s`}
                  type="navigate"
                  onPress={() => {
                    const currentSec = Math.round((settings.app.ngFlashDurationMs || 5000) / 1000);
                    const options = [3, 5, 8, 10, 15, 20, 30, 45, 60];
                    const nextIdx = (options.indexOf(currentSec) + 1) % options.length;
                    updateAppSettings({ ngFlashDurationMs: Math.max(1, options[nextIdx >= 0 ? nextIdx : 0]) * 1000 });
                  }}
                />
                <SettingItem
                  icon="eye-off-outline"
                  title={t.ngAutoClearColor}
                  subtitle={settings.app.ngAutoClearColor ? t.ngAutoClearColorDesc : t.ngAutoClearColorOff}
                  type="switch"
                  switchValue={settings.app.ngAutoClearColor ?? false}
                  onSwitchChange={(v) => updateAppSettings({ ngAutoClearColor: v })}
                />
                <SettingItem
                  icon="resize"
                  title={t.ngMarkerScale}
                  subtitle={t.ngMarkerScaleDesc}
                  value={`${settings.app.ngMarkerScale ?? 1.5}x`}
                  type="navigate"
                  onPress={() => {
                    const current = settings.app.ngMarkerScale ?? 1.5;
                    const options = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
                    const nextIdx = (options.indexOf(current) + 1) % options.length;
                    updateAppSettings({ ngMarkerScale: options[nextIdx >= 0 ? nextIdx : 0] });
                  }}
                />
                <SettingItem
                  icon="timer-alert-outline"
                  title={t.ngExplosionDismiss}
                  value={`${settings.app.ngExplosionDismissSec ?? 5}s`}
                  type="navigate"
                  onPress={() => {
                    const current = settings.app.ngExplosionDismissSec ?? 5;
                    const options = [3, 5, 8, 10, 15, 20, 30, 45, 60];
                    const nextIdx = (options.indexOf(current) + 1) % options.length;
                    updateAppSettings({ ngExplosionDismissSec: Math.max(1, options[nextIdx >= 0 ? nextIdx : 0]) });
                  }}
                />
                <SettingItem
                  icon="alert-decagram-outline"
                  title={t.alertAnimationEnabled}
                  subtitle={t.alertAnimationEnabledDesc}
                  type="switch"
                  switchValue={settings.app.alertAnimationEnabled ?? true}
                  onSwitchChange={(v) => updateAppSettings({ alertAnimationEnabled: v })}
                />
                {(settings.app.alertAnimationEnabled ?? true) && (
                  <>
                    <SettingItem
                      icon="animation-play"
                      title={t.alertAnimationType}
                      value={
                        (settings.app.alertAnimationType ?? 'bomb') === 'bomb'
                          ? t.alertAnimationTypeBomb
                          : (settings.app.alertAnimationType ?? 'bomb') === 'alarm'
                            ? t.alertAnimationTypeAlarm
                            : t.alertAnimationTypeTriangle
                      }
                      type="navigate"
                      onPress={() => {
                        const types: Array<'bomb' | 'alarm' | 'triangle'> = ['bomb', 'alarm', 'triangle'];
                        const current = settings.app.alertAnimationType || 'bomb';
                        const idx = types.indexOf(current);
                        updateAppSettings({ alertAnimationType: types[(idx + 1) % types.length] });
                      }}
                    />
                    <SettingItem
                      icon="timer-outline"
                      title={t.alertAnimationDuration}
                      value={`${settings.app.alertAnimationDurationSec ?? 3}s`}
                      type="navigate"
                      onPress={() => {
                        const options = [1, 2, 3, 4, 5];
                        const current = settings.app.alertAnimationDurationSec || 3;
                        const idx = options.indexOf(current);
                        updateAppSettings({ alertAnimationDurationSec: options[(idx + 1) % options.length] });
                      }}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                {([
                  { key: 'statistics' as const, icon: 'chart-box-outline', label: t.panelSectionStatistics },
                  { key: 'trend' as const, icon: 'chart-timeline-variant', label: t.panelSectionTrend },
                  { key: 'defects' as const, icon: 'chart-bar', label: t.panelSectionDefects },
                  { key: 'captures' as const, icon: 'camera-burst', label: t.panelSectionCaptures },
                  { key: 'measurements' as const, icon: 'ruler-square', label: t.panelSectionMeasurements },
                  { key: 'events' as const, icon: 'timeline-clock-outline', label: t.panelSectionEvents },
                ]).map((item) => (
                  <SettingItem
                    key={item.key}
                    icon={item.icon}
                    title={item.label}
                    type="switch"
                    switchValue={settings.notifications.floatingPanelSections?.[item.key] ?? true}
                    onSwitchChange={(val) => handlePanelSectionToggle(item.key, val)}
                  />
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export { StationDetailSettingsDialog };
