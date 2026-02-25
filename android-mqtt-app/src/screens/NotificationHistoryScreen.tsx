/**
 * Notification History Screen - View all notifications
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  Card,
  Text,
  Chip,
  Button,
  Searchbar,
  Menu,
  IconButton,
  Divider,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useNotificationStore, Notification } from '../store/notificationStore';

type FilterType = 'all' | 'error' | 'warning' | 'info' | 'unread';

export default function NotificationHistoryScreen() {
  const navigation = useNavigation<any>();
  const {
    notifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotificationStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [menuVisible, setMenuVisible] = useState(false);

  const filteredNotifications = notifications.filter((n) => {
    // Apply type filter
    if (filter === 'unread' && n.read) return false;
    if (filter !== 'all' && filter !== 'unread' && n.type !== filter) return false;
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        n.title.toLowerCase().includes(query) ||
        n.body.toLowerCase().includes(query) ||
        n.topic.toLowerCase().includes(query)
      );
    }
    
    return true;
  });

  const renderNotification = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      onPress={() => {
        markAsRead(item.id);
        navigation.navigate('NotificationDetail', { notification: item });
      }}
      activeOpacity={0.7}
    >
      <Card style={[styles.notificationCard, !item.read && styles.unreadCard]}>
        <Card.Content>
          <View style={styles.notificationHeader}>
            <View style={styles.typeIndicator}>
              <Icon
                name={
                  item.type === 'error'
                    ? 'alert-circle'
                    : item.type === 'warning'
                    ? 'alert'
                    : 'information'
                }
                size={24}
                color={
                  item.type === 'error'
                    ? '#ef4444'
                    : item.type === 'warning'
                    ? '#f59e0b'
                    : '#3b82f6'
                }
              />
              <Chip
                style={[
                  styles.typeChip,
                  item.type === 'error' && styles.errorChip,
                  item.type === 'warning' && styles.warningChip,
                  item.type === 'info' && styles.infoChip,
                ]}
                textStyle={styles.typeChipText}
              >
                {item.type === 'error' ? 'Lỗi' : item.type === 'warning' ? 'Cảnh báo' : 'Thông tin'}
              </Chip>
            </View>
            <IconButton
              icon="delete-outline"
              size={20}
              iconColor="#64748b"
              onPress={() => deleteNotification(item.id)}
            />
          </View>
          
          <Text style={[styles.title, !item.read && styles.unreadTitle]}>
            {item.title}
          </Text>
          <Text style={styles.body}>{item.body}</Text>
          
          <View style={styles.footer}>
            <Text style={styles.topic}>{item.topic}</Text>
            <Text style={styles.time}>{formatDateTime(item.timestamp)}</Text>
          </View>
        </Card.Content>
      </Card>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Search and Filter */}
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Tìm kiếm thông báo..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
          iconColor="#94a3b8"
          placeholderTextColor="#64748b"
        />
        
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <IconButton
              icon="filter-variant"
              size={24}
              iconColor="#94a3b8"
              onPress={() => setMenuVisible(true)}
            />
          }
          contentStyle={styles.menuContent}
        >
          <Menu.Item
            onPress={() => { setFilter('all'); setMenuVisible(false); }}
            title="Tất cả"
            leadingIcon={filter === 'all' ? 'check' : undefined}
          />
          <Menu.Item
            onPress={() => { setFilter('unread'); setMenuVisible(false); }}
            title="Chưa đọc"
            leadingIcon={filter === 'unread' ? 'check' : undefined}
          />
          <Divider />
          <Menu.Item
            onPress={() => { setFilter('error'); setMenuVisible(false); }}
            title="Lỗi"
            leadingIcon={filter === 'error' ? 'check' : 'alert-circle'}
          />
          <Menu.Item
            onPress={() => { setFilter('warning'); setMenuVisible(false); }}
            title="Cảnh báo"
            leadingIcon={filter === 'warning' ? 'check' : 'alert'}
          />
          <Menu.Item
            onPress={() => { setFilter('info'); setMenuVisible(false); }}
            title="Thông tin"
            leadingIcon={filter === 'info' ? 'check' : 'information'}
          />
        </Menu>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterChips}>
        {(['all', 'unread', 'error', 'warning', 'info'] as FilterType[]).map((f) => (
          <Chip
            key={f}
            selected={filter === f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, filter === f && styles.filterChipTextSelected]}
          >
            {f === 'all' ? 'Tất cả' : f === 'unread' ? 'Chưa đọc' : f === 'error' ? 'Lỗi' : f === 'warning' ? 'Cảnh báo' : 'Thông tin'}
          </Chip>
        ))}
      </View>

      {/* Mark All Read Button */}
      {notifications.some(n => !n.read) && (
        <Button
          mode="text"
          onPress={markAllAsRead}
          style={styles.markAllButton}
          labelStyle={styles.markAllLabel}
          icon="check-all"
        >
          Đánh dấu tất cả đã đọc
        </Button>
      )}

      {/* Notification List */}
      <FlatList
        data={filteredNotifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="bell-sleep" size={64} color="#475569" />
            <Text style={styles.emptyTitle}>Không có thông báo</Text>
            <Text style={styles.emptyDesc}>
              {searchQuery
                ? 'Không tìm thấy thông báo phù hợp'
                : 'Chưa có thông báo nào được ghi nhận'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function formatDateTime(date: Date): string {
  const d = new Date(date);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  searchbar: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
  },
  searchInput: {
    color: '#f1f5f9',
  },
  menuContent: {
    backgroundColor: '#1e293b',
  },
  filterChips: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#334155',
  },
  filterChipSelected: {
    backgroundColor: '#14b8a6',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  filterChipTextSelected: {
    color: '#ffffff',
  },
  markAllButton: {
    alignSelf: 'flex-end',
    marginRight: 12,
  },
  markAllLabel: {
    color: '#14b8a6',
    fontSize: 12,
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  notificationCard: {
    marginBottom: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#14b8a6',
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeChip: {
    marginLeft: 8,
    height: 24,
  },
  typeChipText: {
    fontSize: 10,
    color: '#ffffff',
  },
  errorChip: {
    backgroundColor: '#7f1d1d',
  },
  warningChip: {
    backgroundColor: '#78350f',
  },
  infoChip: {
    backgroundColor: '#1e3a8a',
  },
  title: {
    color: '#e2e8f0',
    fontSize: 16,
    marginBottom: 4,
  },
  unreadTitle: {
    fontWeight: 'bold',
  },
  body: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topic: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  time: {
    color: '#64748b',
    fontSize: 11,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    color: '#94a3b8',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptyDesc: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
