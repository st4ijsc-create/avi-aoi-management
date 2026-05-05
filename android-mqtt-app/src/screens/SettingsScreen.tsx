/**
 * Settings Screen - MQTT and app configuration
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  Card,
  Title,
  TextInput,
  Button,
  Switch,
  List,
  Divider,
  Text,
  Chip,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  getMqttConfig,
  saveMqttConfig,
  MqttConfig,
} from '../services/mqttService';
import { useNotificationStore } from '../store/notificationStore';

export default function SettingsScreen() {
  const { clearAll } = useNotificationStore();
  const [config, setConfig] = useState<MqttConfig>({
    brokerUrl: '',
    port: 1883,
    username: '',
    password: '',
    clientId: '',
    topics: [],
    enabled: false,
  });
  const [newTopic, setNewTopic] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const savedConfig = await getMqttConfig();
    setConfig(savedConfig);
  };

  const handleSave = async () => {
    if (!config.brokerUrl) {
      Alert.alert('Lỗi', 'Vui lòng nhập địa chỉ MQTT Broker');
      return;
    }

    setSaving(true);
    try {
      await saveMqttConfig(config);
      Alert.alert('Thành công', 'Đã lưu cấu hình MQTT');
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể lưu cấu hình');
    } finally {
      setSaving(false);
    }
  };

  const addTopic = () => {
    if (newTopic && !config.topics.includes(newTopic)) {
      setConfig({
        ...config,
        topics: [...config.topics, newTopic],
      });
      setNewTopic('');
    }
  };

  const removeTopic = (topic: string) => {
    setConfig({
      ...config,
      topics: config.topics.filter(t => t !== topic),
    });
  };

  const handleClearNotifications = () => {
    Alert.alert(
      'Xác nhận',
      'Bạn có chắc muốn xóa tất cả thông báo?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: () => {
            clearAll();
            Alert.alert('Thành công', 'Đã xóa tất cả thông báo');
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* MQTT Connection */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Kết nối MQTT</Title>
          
          <View style={styles.switchRow}>
            <Text style={styles.label}>Bật kết nối MQTT</Text>
            <Switch
              value={config.enabled}
              onValueChange={(value) => setConfig({ ...config, enabled: value })}
            />
          </View>

          <TextInput
            label="Địa chỉ Broker"
            value={config.brokerUrl}
            onChangeText={(text) => setConfig({ ...config, brokerUrl: text })}
            style={styles.input}
            mode="outlined"
            placeholder="mqtt://192.168.1.100"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Port"
            value={config.port.toString()}
            onChangeText={(text) => setConfig({ ...config, port: parseInt(text) || 1883 })}
            style={styles.input}
            mode="outlined"
            keyboardType="numeric"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Username (tùy chọn)"
            value={config.username || ''}
            onChangeText={(text) => setConfig({ ...config, username: text })}
            style={styles.input}
            mode="outlined"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Password (tùy chọn)"
            value={config.password || ''}
            onChangeText={(text) => setConfig({ ...config, password: text })}
            style={styles.input}
            mode="outlined"
            secureTextEntry={!showPassword}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword(!showPassword)}
              />
            }
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Client ID"
            value={config.clientId}
            onChangeText={(text) => setConfig({ ...config, clientId: text })}
            style={styles.input}
            mode="outlined"
            placeholder="avi-mqtt-app-001"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />
        </Card.Content>
      </Card>

      {/* Topics */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Topics đăng ký</Title>
          
          <View style={styles.topicInputRow}>
            <TextInput
              label="Thêm topic"
              value={newTopic}
              onChangeText={setNewTopic}
              style={styles.topicInput}
              mode="outlined"
              placeholder="avi/alerts/#"
              outlineColor="#334155"
              activeOutlineColor="#14b8a6"
              textColor="#f1f5f9"
            />
            <Button
              mode="contained"
              onPress={addTopic}
              style={styles.addButton}
              disabled={!newTopic}
            >
              Thêm
            </Button>
          </View>

          <View style={styles.topicsContainer}>
            {config.topics.map((topic) => (
              <Chip
                key={topic}
                onClose={() => removeTopic(topic)}
                style={styles.topicChip}
                textStyle={styles.topicChipText}
                closeIcon="close"
              >
                {topic}
              </Chip>
            ))}
          </View>

          {config.topics.length === 0 && (
            <Text style={styles.emptyText}>Chưa có topic nào được đăng ký</Text>
          )}
        </Card.Content>
      </Card>

      {/* Default Topics */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Topics mặc định</Title>
          <Text style={styles.description}>
            Nhấn để thêm các topic mặc định cho hệ thống AVI/AOI
          </Text>
          
          <View style={styles.defaultTopics}>
            {[
              'avi/alerts/#',
              'avi/machines/+/status',
              'avi/production/+/error',
              'avi/quality/+/ng',
              'avi/line/+/yield',
            ].map((topic) => (
              <Chip
                key={topic}
                onPress={() => {
                  if (!config.topics.includes(topic)) {
                    setConfig({
                      ...config,
                      topics: [...config.topics, topic],
                    });
                  }
                }}
                style={[
                  styles.defaultTopicChip,
                  config.topics.includes(topic) && styles.topicAdded,
                ]}
                textStyle={styles.defaultTopicText}
                icon={config.topics.includes(topic) ? 'check' : 'plus'}
              >
                {topic}
              </Chip>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* Data Management */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Quản lý dữ liệu</Title>
          
          <List.Item
            title="Xóa tất cả thông báo"
            description="Xóa toàn bộ lịch sử thông báo"
            left={() => <Icon name="delete-sweep" size={24} color="#ef4444" style={styles.listIcon} />}
            onPress={handleClearNotifications}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDesc}
          />
        </Card.Content>
      </Card>

      {/* Save Button */}
      <View style={styles.saveContainer}>
        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          style={styles.saveButton}
          labelStyle={styles.saveLabel}
        >
          Lưu cấu hình
        </Button>
      </View>

      {/* App Info */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Thông tin ứng dụng</Title>
          <List.Item
            title="Phiên bản"
            description="1.0.0"
            left={() => <Icon name="information" size={24} color="#94a3b8" style={styles.listIcon} />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDesc}
          />
          <List.Item
            title="AVI/AOI Management System"
            description="© 2024 - Hệ thống quản lý chất lượng sản xuất"
            left={() => <Icon name="factory" size={24} color="#94a3b8" style={styles.listIcon} />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDesc}
          />
        </Card.Content>
      </Card>

      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  card: {
    margin: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  title: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  label: {
    color: '#e2e8f0',
    fontSize: 16,
  },
  input: {
    marginBottom: 12,
    backgroundColor: '#0f172a',
  },
  topicInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topicInput: {
    flex: 1,
    marginRight: 8,
    backgroundColor: '#0f172a',
  },
  addButton: {
    marginTop: 6,
    backgroundColor: '#14b8a6',
  },
  topicsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  topicChip: {
    margin: 4,
    backgroundColor: '#334155',
  },
  topicChipText: {
    color: '#f1f5f9',
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
  },
  description: {
    color: '#94a3b8',
    marginBottom: 12,
  },
  defaultTopics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  defaultTopicChip: {
    margin: 4,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  defaultTopicText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  topicAdded: {
    backgroundColor: '#14b8a6',
    borderColor: '#14b8a6',
  },
  listIcon: {
    marginLeft: 8,
    marginTop: 8,
  },
  listTitle: {
    color: '#e2e8f0',
  },
  listDesc: {
    color: '#64748b',
  },
  saveContainer: {
    padding: 12,
  },
  saveButton: {
    backgroundColor: '#14b8a6',
    paddingVertical: 8,
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    height: 24,
  },
});
