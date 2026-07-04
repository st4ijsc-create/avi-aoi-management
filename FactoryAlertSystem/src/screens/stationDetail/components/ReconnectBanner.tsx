/**
 * StationDetail — MQTT reconnecting banner (pulse + spinning icon, retry button).
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx (render + animation refs/effect).
 */
import React, { useEffect, useRef } from 'react';
import { Text, TouchableOpacity, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useConnectionStore } from '../../../store/connectionStore';
import { mqttService } from '../../../services/mqttService';
import type { ConnectionStatus } from '../../../types';
import { STATION_T } from '../translations';

const ReconnectBanner: React.FC<{
  mqttStatus: ConnectionStatus;
  reconnectAttempts: number;
  allRetriesFailed: boolean;
  t: typeof STATION_T.vi;
}> = ({ mqttStatus, reconnectAttempts, allRetriesFailed, t }) => {
  // Reconnecting banner animation
  const reconnectPulseAnim = useRef(new Animated.Value(0)).current;
  const reconnectSpinAnim = useRef(new Animated.Value(0)).current;

  const showReconnectBanner = mqttStatus !== 'connected' && (mqttStatus === 'connecting' || mqttStatus === 'disconnected' || mqttStatus === 'error');

  useEffect(() => {
    if (showReconnectBanner && !allRetriesFailed) {
      // Pulsing opacity + spinning icon only during active retry
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(reconnectPulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(reconnectPulseAnim, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      const spin = Animated.loop(
        Animated.timing(reconnectSpinAnim, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })
      );
      pulse.start();
      spin.start();
      return () => { pulse.stop(); spin.stop(); };
    } else if (showReconnectBanner && allRetriesFailed) {
      // Static red banner — no animation
      reconnectPulseAnim.setValue(1);
      reconnectSpinAnim.setValue(0);
    } else {
      reconnectPulseAnim.setValue(0);
      reconnectSpinAnim.setValue(0);
    }
  }, [showReconnectBanner, allRetriesFailed]);

  if (!showReconnectBanner) return null;

  return (
      <Animated.View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: allRetriesFailed ? '#EF4444' : '#F59E0B',
        paddingVertical: 6, paddingHorizontal: 12, gap: 8,
        opacity: allRetriesFailed ? 1 : reconnectPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
      }}>
        <Animated.View style={{
          transform: [{
            rotate: reconnectSpinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
          }],
        }}>
          <Icon name={allRetriesFailed ? 'alert-circle-outline' : 'refresh'} size={16} color="#FFF" />
        </Animated.View>
        <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', flex: 1 }}>
          {allRetriesFailed
            ? t.mqttAllRetriesFailed
            : (mqttStatus === 'connecting' ? t.mqttReconnecting : t.mqttDisconnected)}
          {!allRetriesFailed && reconnectAttempts > 0 && ` (${t.mqttReconnectAttempt} ${reconnectAttempts})`}
        </Text>
        <TouchableOpacity
          onPress={async () => {
            try {
              // Reset allRetriesFailed state for fresh retry
              useConnectionStore.getState().setAllRetriesFailed(false);
              useConnectionStore.getState().resetReconnectAttempts();
              mqttService.resetAllRetriesExhausted();
              await mqttService.connect();
            } catch (e) { console.warn('[MQTT] Banner reconnect failed:', e); }
          }}
          style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }}
          activeOpacity={0.7}
        >
          <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>{t.mqttDisconnectRetry}</Text>
        </TouchableOpacity>
      </Animated.View>
  );
};

export { ReconnectBanner };
