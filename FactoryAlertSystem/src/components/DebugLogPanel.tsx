/**
 * DebugLogPanel — Floating overlay for viewing debug logs
 * Shows API requests, responses, user actions in real-time
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Dimensions,
  Alert as RNAlert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { debugLogger, DebugLogEntry, DebugLogType } from '../utils/debugLogger';

const { width: SW, height: SH } = Dimensions.get('window');

const TYPE_COLORS: Record<DebugLogType, string> = {
  API_REQUEST: '#60A5FA',   // blue
  API_RESPONSE: '#34D399',  // green
  API_ERROR: '#F87171',     // red
  USER_ACTION: '#FBBF24',   // amber
  SYSTEM: '#A78BFA',        // purple
  MQTT: '#2DD4BF',          // teal
};

const TYPE_ICONS: Record<DebugLogType, string> = {
  API_REQUEST: 'arrow-up-bold',
  API_RESPONSE: 'arrow-down-bold',
  API_ERROR: 'alert-circle',
  USER_ACTION: 'gesture-tap',
  SYSTEM: 'cog',
  MQTT: 'access-point',
};

const TYPE_SHORT: Record<DebugLogType, string> = {
  API_REQUEST: 'REQ',
  API_RESPONSE: 'RES',
  API_ERROR: 'ERR',
  USER_ACTION: 'ACT',
  SYSTEM: 'SYS',
  MQTT: 'MQTT',
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

const DebugLogPanel: React.FC<Props> = ({ visible, onClose }) => {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [filter, setFilter] = useState<DebugLogType | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!visible) return;
    setLogs([...debugLogger.getLogs()]);
    const unsub = debugLogger.subscribe(() => {
      setLogs([...debugLogger.getLogs()]);
    });
    return unsub;
  }, [visible]);

  useEffect(() => {
    if (autoScroll && logs.length > 0 && visible) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [logs.length, autoScroll, visible]);

  const filtered = filter ? logs.filter((l) => l.type === filter) : logs;

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    RNAlert.alert('Clear Logs', 'Xóa toàn bộ log?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { debugLogger.clear(); setExpanded(new Set()); } },
    ]);
  }, []);

  const handleShare = useCallback(async () => {
    try {
      await debugLogger.shareLog();
    } catch (e) {
      console.error('[DebugLogPanel] share error:', e);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const result = await debugLogger.exportToFile();
      if (result) {
        RNAlert.alert('Saved', `Log saved & shared. Key: ${result}`);
      }
    } catch (e) {
      console.error('[DebugLogPanel] save error:', e);
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: DebugLogEntry }) => {
    const color = TYPE_COLORS[item.type];
    const icon = TYPE_ICONS[item.type];
    const short = TYPE_SHORT[item.type];
    const isExpanded = expanded.has(item.id);
    const time = item.timestamp.substring(11, 23);
    const dur = item.durationMs !== undefined ? ` ${item.durationMs}ms` : '';

    return (
      <TouchableOpacity
        style={[st.logItem, { borderLeftColor: color }]}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={st.logHeader}>
          <Icon name={icon} size={12} color={color} />
          <Text style={[st.logType, { color }]}>{short}</Text>
          <Text style={st.logTime}>{time}</Text>
          {dur ? <Text style={st.logDur}>{dur}</Text> : null}
          <Text style={st.logTag}>[{item.tag}]</Text>
        </View>
        <Text style={st.logMsg} numberOfLines={isExpanded ? undefined : 2}>{item.message}</Text>
        {isExpanded && item.data !== undefined && (
          <View style={st.logData}>
            <Text style={st.logDataText}>
              {typeof item.data === 'string' ? item.data : JSON.stringify(item.data, null, 2)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [expanded, toggleExpand]);

  const keyExtractor = useCallback((item: DebugLogEntry) => String(item.id), []);

  if (!visible) return null;

  const filterTypes: (DebugLogType | null)[] = [null, 'API_REQUEST', 'API_RESPONSE', 'API_ERROR', 'USER_ACTION', 'SYSTEM', 'MQTT'];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <Icon name="bug" size={18} color="#F59E0B" />
          <Text style={st.title}>Debug Log</Text>
          <Text style={st.count}>{filtered.length}/{logs.length}</Text>
          <View style={st.headerActions}>
            <TouchableOpacity onPress={() => setAutoScroll(!autoScroll)} style={st.hBtn}>
              <Icon name={autoScroll ? 'arrow-down-circle' : 'arrow-down-circle-outline'} size={18} color={autoScroll ? '#34D399' : '#666'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClear} style={st.hBtn}>
              <Icon name="delete-outline" size={18} color="#F87171" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={st.hBtn}>
              <Icon name="share-variant" size={18} color="#60A5FA" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={st.hBtn}>
              <Icon name="content-save-outline" size={18} color="#34D399" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={st.hBtn}>
              <Icon name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Filter bar */}
        <View style={st.filterBar}>
          {filterTypes.map((ft) => {
            const active = filter === ft;
            const label = ft ? TYPE_SHORT[ft] : 'ALL';
            const color = ft ? TYPE_COLORS[ft] : '#fff';
            return (
              <TouchableOpacity
                key={label}
                style={[st.filterBtn, active && { backgroundColor: color + '30', borderColor: color }]}
                onPress={() => setFilter(ft)}
              >
                <Text style={[st.filterText, { color: active ? color : '#888' }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Log list */}
        <FlatList
          ref={listRef}
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={st.list}
          contentContainerStyle={st.listContent}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={st.empty}>
              <Icon name="bug-outline" size={40} color="#444" />
              <Text style={st.emptyText}>No logs yet</Text>
              <Text style={st.emptyHint}>Logs will appear as you interact with the screen</Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
};

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    gap: 8,
  },
  title: { color: '#F59E0B', fontSize: 14, fontWeight: '800' },
  count: { color: '#888', fontSize: 11, fontWeight: '600' },
  headerActions: { flexDirection: 'row', marginLeft: 'auto', gap: 4 },
  hBtn: { padding: 6 },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  filterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  filterText: { fontSize: 10, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 20 },
  logItem: {
    backgroundColor: '#141414',
    borderRadius: 6,
    padding: 8,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderColor: '#333',
  },
  logHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  logType: { fontSize: 9, fontWeight: '800' },
  logTime: { fontSize: 9, color: '#666', fontFamily: 'monospace' },
  logDur: { fontSize: 9, color: '#F59E0B', fontWeight: '700' },
  logTag: { fontSize: 9, color: '#888', fontWeight: '600' },
  logMsg: { fontSize: 11, color: '#ccc', lineHeight: 15 },
  logData: {
    marginTop: 4,
    backgroundColor: '#0D0D0D',
    borderRadius: 4,
    padding: 6,
    maxHeight: 200,
  },
  logDataText: { fontSize: 9, color: '#888', fontFamily: 'monospace', lineHeight: 13 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#555', fontSize: 14, fontWeight: '700', marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 11, marginTop: 4 },
});

export default DebugLogPanel;
