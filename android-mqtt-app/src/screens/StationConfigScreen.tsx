/**
 * Station Config Screen - Configure workstation for notifications
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
  Text,
  List,
  Divider,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import {
  getStationConfig,
  saveStationConfig,
  StationConfig,
  saveMqttConfig,
  getMqttConfig,
} from '../services/mqttService';

export default function StationConfigScreen() {
  const navigation = useNavigation();
  const [config, setConfig] = useState<StationConfig>({
    stationId: '',
    stationName: '',
    lineId: '',
    lineName: '',
    factoryId: '',
    factoryName: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const savedConfig = await getStationConfig();
    if (savedConfig) {
      setConfig(savedConfig);
    }
  };

  const handleSave = async () => {
    if (!config.stationId || !config.stationName) {
      Alert.alert('Lỗi', 'Vui lòng nhập ID và tên công trạm');
      return;
    }

    setSaving(true);
    try {
      await saveStationConfig(config);
      
      // Auto-subscribe to station-specific topics
      const mqttConfig = await getMqttConfig();
      const stationTopics = [
        `avi/station/${config.stationId}/alerts`,
        `avi/station/${config.stationId}/status`,
        `avi/line/${config.lineId}/alerts`,
        `avi/line/${config.lineId}/yield`,
      ].filter(t => !mqttConfig.topics.includes(t));
      
      if (stationTopics.length > 0) {
        await saveMqttConfig({
          topics: [...mqttConfig.topics, ...stationTopics],
        });
      }
      
      Alert.alert('Thành công', 'Đã lưu cấu hình công trạm', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể lưu cấu hình');
    } finally {
      setSaving(false);
    }
  };

  const handleScanQR = () => {
    Alert.alert(
      'Quét mã QR',
      'Tính năng quét mã QR để cấu hình tự động sẽ được triển khai trong phiên bản tiếp theo.',
      [{ text: 'OK' }]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* Quick Setup */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Cài đặt nhanh</Title>
          <Text style={styles.description}>
            Quét mã QR tại công trạm để cấu hình tự động
          </Text>
          <Button
            mode="contained"
            icon="qrcode-scan"
            onPress={handleScanQR}
            style={styles.scanButton}
          >
            Quét mã QR
          </Button>
        </Card.Content>
      </Card>

      <View style={styles.dividerContainer}>
        <Divider style={styles.divider} />
        <Text style={styles.dividerText}>hoặc nhập thủ công</Text>
        <Divider style={styles.divider} />
      </View>

      {/* Factory Info */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.sectionHeader}>
            <Icon name="factory" size={24} color="#14b8a6" />
            <Title style={styles.sectionTitle}>Thông tin nhà máy</Title>
          </View>

          <TextInput
            label="ID Nhà máy"
            value={config.factoryId}
            onChangeText={(text) => setConfig({ ...config, factoryId: text })}
            style={styles.input}
            mode="outlined"
            placeholder="factory-001"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Tên nhà máy"
            value={config.factoryName}
            onChangeText={(text) => setConfig({ ...config, factoryName: text })}
            style={styles.input}
            mode="outlined"
            placeholder="Nhà máy A"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />
        </Card.Content>
      </Card>

      {/* Line Info */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.sectionHeader}>
            <Icon name="transit-connection-horizontal" size={24} color="#06b6d4" />
            <Title style={styles.sectionTitle}>Thông tin dây chuyền</Title>
          </View>

          <TextInput
            label="ID Dây chuyền"
            value={config.lineId}
            onChangeText={(text) => setConfig({ ...config, lineId: text })}
            style={styles.input}
            mode="outlined"
            placeholder="line-001"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Tên dây chuyền"
            value={config.lineName}
            onChangeText={(text) => setConfig({ ...config, lineName: text })}
            style={styles.input}
            mode="outlined"
            placeholder="Dây chuyền 1"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />
        </Card.Content>
      </Card>

      {/* Station Info */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.sectionHeader}>
            <Icon name="desktop-tower-monitor" size={24} color="#f59e0b" />
            <Title style={styles.sectionTitle}>Thông tin công trạm</Title>
          </View>

          <TextInput
            label="ID Công trạm *"
            value={config.stationId}
            onChangeText={(text) => setConfig({ ...config, stationId: text })}
            style={styles.input}
            mode="outlined"
            placeholder="station-001"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />

          <TextInput
            label="Tên công trạm *"
            value={config.stationName}
            onChangeText={(text) => setConfig({ ...config, stationName: text })}
            style={styles.input}
            mode="outlined"
            placeholder="Công trạm kiểm tra 1"
            outlineColor="#334155"
            activeOutlineColor="#14b8a6"
            textColor="#f1f5f9"
          />
        </Card.Content>
      </Card>

      {/* Topics Preview */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Topics sẽ được đăng ký</Title>
          <Text style={styles.description}>
            Các topic MQTT sau sẽ được tự động đăng ký khi lưu cấu hình:
          </Text>
          
          <List.Item
            title={`avi/station/${config.stationId || '{stationId}'}/alerts`}
            left={() => <Icon name="bell" size={20} color="#ef4444" style={styles.topicIcon} />}
            titleStyle={styles.topicText}
          />
          <List.Item
            title={`avi/station/${config.stationId || '{stationId}'}/status`}
            left={() => <Icon name="information" size={20} color="#3b82f6" style={styles.topicIcon} />}
            titleStyle={styles.topicText}
          />
          <List.Item
            title={`avi/line/${config.lineId || '{lineId}'}/alerts`}
            left={() => <Icon name="alert" size={20} color="#f59e0b" style={styles.topicIcon} />}
            titleStyle={styles.topicText}
          />
          <List.Item
            title={`avi/line/${config.lineId || '{lineId}'}/yield`}
            left={() => <Icon name="chart-line" size={20} color="#22c55e" style={styles.topicIcon} />}
            titleStyle={styles.topicText}
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
    marginBottom: 8,
  },
  description: {
    color: '#94a3b8',
    marginBottom: 16,
  },
  scanButton: {
    backgroundColor: '#14b8a6',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 8,
  },
  divider: {
    flex: 1,
    backgroundColor: '#334155',
  },
  dividerText: {
    color: '#64748b',
    marginHorizontal: 12,
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  input: {
    marginBottom: 12,
    backgroundColor: '#0f172a',
  },
  topicIcon: {
    marginLeft: 8,
    marginTop: 8,
  },
  topicText: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: 'monospace',
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
