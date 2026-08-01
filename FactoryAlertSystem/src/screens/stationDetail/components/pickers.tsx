/**
 * StationDetail — station picker modal + product/workstation dropdown selectors.
 * MB11 decomposition (seam 3 — ProductPicker): moved verbatim from StationDetailScreen.tsx.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../context';
import type { Language } from '../../../types';
import type { ProductCatalogItem, WorkstationInfo } from '../../../services/stationService';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import { getS } from '../styles';

// ============================================
// STATION PICKER MODAL (dark)
// ============================================
const StationPickerModal: React.FC<{
  visible: boolean;
  stations: string[];
  stationNames: Record<string, string>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  t: typeof STATION_T.vi;
  language: Language;
}> = ({ visible, stations, stationNames, activeId, onSelect, onClose, t, language }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { pkS } = getS(theme.isDark);
  const [searchText, setSearchText] = useState('');

  const filtered = useMemo(() => {
    if (!searchText.trim()) return stations;
    const q = searchText.trim().toLowerCase();
    return stations.filter((id) => {
      const name = stationNames[id] || '';
      return id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
  }, [stations, stationNames, searchText]);

  // Reset search when modal closes
  useEffect(() => { if (!visible) setSearchText(''); }, [visible]);

  return (
  <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
    <TouchableOpacity style={pkS.backdrop} activeOpacity={1} onPress={onClose}>
      <View style={pkS.container}>
        <Text style={pkS.title}>{t.stationPicker}</Text>
        {stations.length > 5 && (
          <View style={pkS.searchWrap}>
            <Icon name="magnify" size={16} color={C.textMuted} />
            <TextInput
              style={pkS.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t.searchPlaceholder}
              placeholderTextColor={C.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <ScrollView style={pkS.list} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', paddingVertical: 20 }}>{t.noSearchResults}</Text>
          ) : filtered.map((id) => {
            const isActive = id === activeId;
            const name = stationNames[id];
            const displayName = name && name !== id ? name : id;
            return (
              <TouchableOpacity
                key={id}
                style={[pkS.item, isActive && pkS.itemActive]}
                onPress={() => { onSelect(id); onClose(); }}
                activeOpacity={0.7}
              >
                <Icon
                  name={isActive ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={isActive ? C.accent : C.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[pkS.itemText, isActive && { color: C.accent, fontWeight: '700' }]}>{displayName}</Text>
                  {name && name !== id && (
                    <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{id}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={pkS.closeBtn} onPress={onClose}>
          <Text style={pkS.closeBtnText}>{t.close}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  </Modal>
  );
};


// ============================================
// PRODUCT SELECTOR (dropdown combobox)
// ============================================
const ProductSelector: React.FC<{
  products: ProductCatalogItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (p: ProductCatalogItem) => void;
  t: typeof STATION_T.vi;
}> = ({ products, selectedId, loading, onSelect, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { prodS } = getS(theme.isDark);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const selected = products.find((p) => String(p.id) === selectedId) || null;

  const filtered = useMemo(() => {
    if (!searchText.trim()) return products;
    const q = searchText.trim().toLowerCase();
    return products.filter((p) =>
      (p.code || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q),
    );
  }, [products, searchText]);

  const handleClose = useCallback(() => { setDropdownOpen(false); setSearchText(''); }, []);

  return (
    <View style={prodS.wrap}>
      <View style={prodS.row}>
        {/* Dropdown trigger */}
        <TouchableOpacity
          style={prodS.dropdown}
          onPress={() => setDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Icon name="package-variant" size={14} color={C.accent} />
          <Text style={prodS.dropdownText} numberOfLines={1}>
            {loading ? t.loadingProducts : selected ? (selected.code || selected.name) : t.productSelector}
          </Text>
          {loading ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Icon name="chevron-down" size={18} color={C.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Dropdown modal */}
      <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={handleClose}>
        <TouchableOpacity style={prodS.overlay} activeOpacity={1} onPress={handleClose}>
          <View style={prodS.modal}>
            <View style={prodS.modalHeader}>
              <Icon name="package-variant" size={16} color={C.accent} />
              <Text style={prodS.modalTitle}>{t.productSelector}</Text>
            </View>
            {products.length > 5 && (
              <View style={prodS.searchWrap}>
                <Icon name="magnify" size={16} color={C.textMuted} />
                <TextInput
                  style={prodS.searchInput}
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder={t.searchPlaceholder}
                  placeholderTextColor={C.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {searchText.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="close-circle" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            <ScrollView style={prodS.modalScroll} showsVerticalScrollIndicator={false}>
              {filtered.length === 0 ? (
                <Text style={prodS.empty}>{products.length === 0 ? t.noProducts : t.noSearchResults}</Text>
              ) : (
                filtered.map((p) => {
                  const active = String(p.id) === selectedId;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[prodS.option, active && prodS.optionActive]}
                      onPress={() => { onSelect(p); handleClose(); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[prodS.optionCode, active && { color: '#FFF' }]}>{p.code || p.name}</Text>
                        {p.name && p.name !== p.code && (
                          <Text style={[prodS.optionName, active && { color: 'rgba(255,255,255,0.7)' }]}>{p.name}</Text>
                        )}
                      </View>
                      {active && <Icon name="check" size={18} color="#FFF" />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};


// ============================================
// WORKSTATION SELECTOR (dropdown combobox)
// ============================================
const WorkstationSelector: React.FC<{
  workstations: WorkstationInfo[];
  selectedId: number | null;
  loading: boolean;
  onSelect: (ws: WorkstationInfo) => void;
  t: typeof STATION_T.vi;
}> = ({ workstations, selectedId, loading, onSelect, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { prodS } = getS(theme.isDark);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const selected = workstations.find((ws) => ws.id === selectedId) || null;

  const filtered = useMemo(() => {
    if (!searchText.trim()) return workstations;
    const q = searchText.trim().toLowerCase();
    return workstations.filter((ws) =>
      (ws.code || '').toLowerCase().includes(q) || (ws.name || '').toLowerCase().includes(q),
    );
  }, [workstations, searchText]);

  const handleClose = useCallback(() => { setDropdownOpen(false); setSearchText(''); }, []);

  return (
    <View style={prodS.wrap}>
      <View style={prodS.row}>
        <TouchableOpacity
          style={prodS.dropdown}
          onPress={() => setDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Icon name="cog-outline" size={14} color={C.warn} />
          <Text style={prodS.dropdownText} numberOfLines={1}>
            {loading ? t.loadingProducts : selected ? (selected.code || selected.name) : t.workstationSelector}
          </Text>
          {loading ? (
            <ActivityIndicator size="small" color={C.warn} />
          ) : (
            <Icon name="chevron-down" size={18} color={C.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={handleClose}>
        <TouchableOpacity style={prodS.overlay} activeOpacity={1} onPress={handleClose}>
          <View style={prodS.modal}>
            <View style={prodS.modalHeader}>
              <Icon name="cog-outline" size={16} color={C.warn} />
              <Text style={prodS.modalTitle}>{t.workstationSelector}</Text>
            </View>
            {workstations.length > 5 && (
              <View style={prodS.searchWrap}>
                <Icon name="magnify" size={16} color={C.textSecondary} />
                <TextInput
                  style={[prodS.searchInput, { color: C.text }]}
                  placeholder={t.searchPlaceholder}
                  placeholderTextColor={C.textSecondary}
                  value={searchText}
                  onChangeText={setSearchText}
                  autoCorrect={false}
                />
                {searchText.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="close-circle" size={16} color={C.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            <ScrollView style={prodS.modalScroll} showsVerticalScrollIndicator={false}>
              {workstations.length === 0 ? (
                <Text style={prodS.empty}>{t.noWorkstations}</Text>
              ) : filtered.length === 0 ? (
                <Text style={prodS.empty}>{t.noSearchResults}</Text>
              ) : (
                filtered.map((ws) => {
                  const active = ws.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={ws.id}
                      style={[prodS.option, active && prodS.optionActive]}
                      onPress={() => { onSelect(ws); handleClose(); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[prodS.optionCode, active && { color: '#FFF' }]}>{ws.code || ws.name}</Text>
                        {ws.name && ws.name !== ws.code && (
                          <Text style={[prodS.optionName, active && { color: 'rgba(255,255,255,0.7)' }]}>{ws.name}</Text>
                        )}
                      </View>
                      {active && <Icon name="check" size={18} color="#FFF" />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export { StationPickerModal, ProductSelector, WorkstationSelector };
