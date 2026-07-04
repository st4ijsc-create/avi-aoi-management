/**
 * Factory Alert System - Hierarchy Tree Selector
 * Component chọn MQTT subscriptions từ cây phân cấp Factory → Workshop → Line → Station → Machine
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  hierarchyService,
  HierarchyFactory,
  HierarchyNode,
  SubscriptionItem,
} from '../services/hierarchyService';
import { useTheme, Theme } from '../context/ThemeContext';

// ── Level config ──

const LEVEL_CONFIG: Record<
  HierarchyNode['level'],
  { icon: string; color: string; indent: number }
> = {
  factory: { icon: 'factory', color: '#2563EB', indent: 0 },
  workshop: { icon: 'warehouse', color: '#7C3AED', indent: 20 },
  line: { icon: 'transit-connection-horizontal', color: '#059669', indent: 40 },
  station: { icon: 'desktop-classic', color: '#EA580C', indent: 60 },
  machine: { icon: 'robot-industrial', color: '#6366F1', indent: 80 },
};

// ── Props ──

interface Props {
  apiBaseUrl: string;
  apiKey?: string;
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  language: 'vi' | 'en' | 'zh';
}

// ── Component ──

const HierarchyTreeSelector: React.FC<Props> = ({
  apiBaseUrl,
  apiKey,
  selectedKeys,
  onSelectionChange,
  language,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factories, setFactories] = useState<HierarchyFactory[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build node tree from raw API data
  const nodeTree = useMemo(
    () => hierarchyService.buildNodeTree(factories),
    [factories],
  );

  // Current subscriptions derived from selection
  const subscriptions = useMemo(
    () => hierarchyService.generateTopicsFromSelection(selectedKeys, factories),
    [selectedKeys, factories],
  );

  // ── Load hierarchy when apiBaseUrl changes ──
  const loadTree = useCallback(async () => {
    if (!apiBaseUrl) {
      setError(
        language === 'vi'
          ? 'Vui lòng cấu hình API Server URL trước.'
          : language === 'zh'
          ? '请先配置API服务器URL。'
          : 'Please configure API Server URL first.',
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await hierarchyService.fetchTree(apiBaseUrl, apiKey);
      setFactories(data);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      setError(
        language === 'vi'
          ? `Không thể tải cây phân cấp: ${msg}`
          : language === 'zh'
          ? `无法加载层级结构: ${msg}`
          : `Failed to load hierarchy: ${msg}`,
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, apiKey, language]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // ── Toggle expand/collapse ──
  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ── Collect all descendant keys of a node ──
  const getAllDescendantKeys = useCallback((node: HierarchyNode): string[] => {
    const keys: string[] = [];
    for (const child of node.children) {
      keys.push(child.key);
      keys.push(...getAllDescendantKeys(child));
    }
    return keys;
  }, []);

  // ── Toggle selection of a node (and descendants) ──
  const toggleSelect = useCallback(
    (node: HierarchyNode) => {
      const isSelected = selectedKeys.includes(node.key);
      const descendantKeys = getAllDescendantKeys(node);
      const allRelatedKeys = [node.key, ...descendantKeys];

      let newKeys: string[];
      if (isSelected) {
        // Deselect this node and all descendants
        newKeys = selectedKeys.filter((k) => !allRelatedKeys.includes(k));
      } else {
        // Select this node and all descendants
        const addedSet = new Set([...selectedKeys, ...allRelatedKeys]);
        newKeys = Array.from(addedSet);
      }

      onSelectionChange(newKeys);
    },
    [selectedKeys, onSelectionChange, getAllDescendantKeys],
  );

  // ── Check if any descendant is selected ──
  const hasSelectedDescendant = useCallback(
    (node: HierarchyNode): boolean => {
      for (const child of node.children) {
        if (selectedKeys.includes(child.key)) return true;
        if (hasSelectedDescendant(child)) return true;
      }
      return false;
    },
    [selectedKeys],
  );

  // ── Render a single node row ──
  const renderNode = useCallback(
    (node: HierarchyNode): React.ReactNode => {
      const config = LEVEL_CONFIG[node.level];
      const isExpanded = expanded.has(node.key);
      const isSelected = selectedKeys.includes(node.key);
      const hasChildren = node.children.length > 0;
      const isPartial = !isSelected && hasSelectedDescendant(node);

      return (
        <View key={node.key}>
          <TouchableOpacity
            style={[styles.nodeRow, { paddingLeft: 12 + config.indent }]}
            onPress={() => toggleSelect(node)}
            activeOpacity={0.7}
          >
            {/* Expand/Collapse arrow */}
            {hasChildren ? (
              <TouchableOpacity
                onPress={() => toggleExpand(node.key)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.expandButton}
              >
                <Icon
                  name={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size={20}
                  color={theme.colors.textSecondary}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.expandPlaceholder} />
            )}

            {/* Checkbox */}
            <Icon
              name={
                isSelected
                  ? 'checkbox-marked'
                  : isPartial
                  ? 'minus-box'
                  : 'checkbox-blank-outline'
              }
              size={22}
              color={
                isSelected
                  ? config.color
                  : isPartial
                  ? config.color
                  : theme.colors.textMuted
              }
            />

            {/* Level icon */}
            <Icon
              name={config.icon}
              size={18}
              color={config.color}
              style={styles.nodeIcon}
            />

            {/* Name & code */}
            <View style={styles.nodeTextContainer}>
              <Text style={styles.nodeName} numberOfLines={1}>
                {node.name}
              </Text>
              <Text style={styles.nodeCode}>{node.code}</Text>
            </View>
          </TouchableOpacity>

          {/* Children */}
          {hasChildren && isExpanded && node.children.map(renderNode)}
        </View>
      );
    },
    [expanded, selectedKeys, toggleSelect, toggleExpand, hasSelectedDescendant, styles, theme],
  );

  // ── Remove a subscription chip ──
  const handleRemoveSubscription = useCallback(
    (item: SubscriptionItem) => {
      onSelectionChange(selectedKeys.filter((k) => k !== item.nodeKey));
    },
    [selectedKeys, onSelectionChange],
  );

  // ── Render ──

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={styles.loadingText}>
          {language === 'vi' ? 'Đang tải cây phân cấp...' : language === 'zh' ? '加载层级结构中...' : 'Loading hierarchy...'}
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="alert-circle-outline" size={32} color={theme.colors.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadTree}>
          <Icon name="reload" size={18} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>
            {language === 'vi' ? 'Thử lại' : language === 'zh' ? '重试' : 'Retry'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (factories.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="database-off-outline" size={32} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>
          {language === 'vi'
            ? 'Không có dữ liệu phân cấp.'
            : language === 'zh'
            ? '暂无层级数据。'
            : 'No hierarchy data available.'}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadTree}>
          <Icon name="reload" size={18} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>
            {language === 'vi' ? 'Tải lại' : language === 'zh' ? '重新加载' : 'Reload'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with actions */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {language === 'vi' ? 'Chọn khu vực nhận cảnh báo' : language === 'zh' ? '选择警报区域' : 'Select alert areas'}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionBtn} onPress={loadTree}>
            <Icon name="reload" size={16} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => {
              // Expand all
              const allKeys = new Set<string>();
              const collectKeys = (nodes: HierarchyNode[]) => {
                for (const n of nodes) {
                  if (n.children.length > 0) {
                    allKeys.add(n.key);
                    collectKeys(n.children);
                  }
                }
              };
              collectKeys(nodeTree);
              setExpanded(allKeys);
            }}
          >
            <Icon name="unfold-more-horizontal" size={16} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => setExpanded(new Set())}
          >
            <Icon name="unfold-less-horizontal" size={16} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tree */}
      <ScrollView style={styles.treeScroll} nestedScrollEnabled>
        {nodeTree.map(renderNode)}
      </ScrollView>

      {/* Selected subscriptions summary */}
      {subscriptions.length > 0 && (
        <View style={styles.subscriptionSummary}>
          <Text style={styles.subscriptionTitle}>
            {`MQTT Topics (${subscriptions.length})`}
          </Text>
          <View style={styles.subscriptionChips}>
            {subscriptions.map((item) => (
              <View key={item.topic} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {item.topic}
                </Text>
                <TouchableOpacity
                  onPress={() => handleRemoveSubscription(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close-circle" size={16} color={theme.colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

// ── Styles ──

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  centerContainer: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },
  loadingText: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  errorText: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    gap: 6,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: `${theme.colors.primary}08`,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerActionBtn: {
    padding: 6,
    borderRadius: theme.borderRadius.sm,
  },
  treeScroll: {
    maxHeight: 300,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    gap: 6,
  },
  expandButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandPlaceholder: {
    width: 24,
  },
  nodeIcon: {
    marginLeft: 2,
  },
  nodeTextContainer: {
    flex: 1,
    marginLeft: 4,
  },
  nodeName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: '500',
  },
  nodeCode: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
  },
  subscriptionSummary: {
    padding: theme.spacing.md,
    backgroundColor: `${theme.colors.success}08`,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  subscriptionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  subscriptionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.primary}12`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    gap: 4,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.primary,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
});

export default HierarchyTreeSelector;
