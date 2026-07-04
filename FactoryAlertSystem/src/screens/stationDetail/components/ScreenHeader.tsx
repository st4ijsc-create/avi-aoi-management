/**
 * StationDetail — screen header: back / station picker / title + live badge /
 * MQTT status / fullscreen / settings buttons.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx (actions threaded as props).
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

import { useTheme } from '../../../context';
import { mqttService } from '../../../services/mqttService';
import type { ConnectionStatus, Language, StationInspectionData } from '../../../types';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import { formatTimeAgo } from '../utils/format';
import { getS } from '../styles';

const ScreenHeader: React.FC<{
  t: typeof STATION_T.vi;
  lang: Language;
  activeStation: StationInspectionData | null;
  mqttStatus: ConnectionStatus;
  fetchStationNames: () => void;
  onBack: () => void;
  onOpenPicker: () => void;
  onEnterFullScreen: () => void;
  onOpenSettings: () => void;
}> = ({ t, lang, activeStation, mqttStatus, fetchStationNames, onBack, onOpenPicker, onEnterFullScreen, onOpenSettings }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { s } = getS(theme.isDark);

  return (
    <LinearGradient colors={[C.surface, C.bg]} style={s.header}>
      <TouchableOpacity
        onPress={onBack}
        style={s.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="arrow-left" size={22} color={C.text} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onOpenPicker}
        style={[s.switchBtn, { marginLeft: 6 }]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="swap-horizontal" size={16} color={C.accent} />
      </TouchableOpacity>
      <View style={s.headerCenter}>
        <Text style={s.headerTitle} numberOfLines={1}>
          {activeStation?.config.stationName || t.title}
        </Text>
        {activeStation && (
          <View style={s.headerSub}>
            {activeStation.isLive && (
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>{t.live}</Text>
              </View>
            )}
            <Text style={s.subText}>{activeStation.config.category}</Text>
            {activeStation.lastUpdated && (
              <Text style={s.subText}> · {formatTimeAgo(activeStation.lastUpdated, lang)}</Text>
            )}
          </View>
        )}
      </View>
      {/* MQTT connection status button */}
      <TouchableOpacity
        onPress={async () => {
          try {
            await mqttService.connect();
            fetchStationNames();
          } catch (e) {
            console.warn('[StationDetail] MQTT reconnect failed:', e);
          }
        }}
        style={[s.fullScreenBtn, { marginRight: 2 }]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: mqttStatus === 'connected' ? '#22C55E'
              : mqttStatus === 'connecting' ? '#F59E0B'
              : '#EF4444',
          }} />
          <Icon
            name={mqttStatus === 'connected' ? 'access-point' : mqttStatus === 'connecting' ? 'access-point-network' : 'access-point-network-off'}
            size={16}
            color={mqttStatus === 'connected' ? '#22C55E' : mqttStatus === 'connecting' ? '#F59E0B' : '#EF4444'}
          />
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onEnterFullScreen}
        style={s.fullScreenBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="fullscreen" size={18} color={C.accent} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onOpenSettings}
        style={s.switchBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="cog" size={16} color={C.accent} />
      </TouchableOpacity>
    </LinearGradient>
  );
};

export { ScreenHeader };
