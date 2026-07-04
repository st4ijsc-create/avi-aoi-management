/**
 * MQTT Connection Test Component
 * Use this to test MQTT connection after fixing the socket errors
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Share, Alert } from 'react-native';
import { Button, Card, Text, Chip } from 'react-native-paper';
import { mqttService } from '../services/mqttService';
import { ConnectionStatus } from '../types';
import { useSettingsStore, selectSettings } from '../store';

export const MqttConnectionTest: React.FC = () => {
  const settings = useSettingsStore(selectSettings);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [detailedLogs, setDetailedLogs] = useState<string[]>([]);
  const [circuitBreakerStatus, setCircuitBreakerStatus] = useState({ 
    isOpen: false, 
    consecutiveFailures: 0, 
    remainingTimeMs: 0 
  });

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const fullTimestamp = new Date().toISOString();
    
    // Display logs (limited)
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[MqttConnectionTest] ${logEntry}`);
    setLogs(prev => [...prev.slice(-8), logEntry]); // Keep more logs
    
    // Detailed logs for export (unlimited)
    const detailedEntry = `[${fullTimestamp}] ${message}`;
    setDetailedLogs(prev => [...prev, detailedEntry]);
  };

  const updateCircuitBreakerStatus = () => {
    const cbStatus = mqttService.getCircuitBreakerStatus();
    setCircuitBreakerStatus(cbStatus);
  };

  useEffect(() => {
    // Log system info for debugging
    addLog('=== MQTT Connection Test Started ===');
    addLog(`System: React Native Android`);
    addLog(`Current Config: ${settings.mqtt.brokerAddress}:${settings.mqtt.port} (${settings.mqtt.protocol.toUpperCase()})`);
    addLog('=====================================');
    
    // Set up MQTT callbacks
    mqttService.setOnConnectionChange((newStatus, errorMsg) => {
      setStatus(newStatus);
      setError(errorMsg || null);
      addLog(`Status: ${newStatus} ${errorMsg ? `(${errorMsg})` : ''}`);
      updateCircuitBreakerStatus();
    });

    mqttService.setOnError((error) => {
      addLog(`Error: ${error.message}`);
      updateCircuitBreakerStatus();
    });

    mqttService.setOnMessage((alert) => {
      addLog(`Message received: ${alert.alertId}`);
    });

    // Update circuit breaker status every second
    const interval = setInterval(updateCircuitBreakerStatus, 1000);

    // Initial update
    updateCircuitBreakerStatus();

    return () => {
      mqttService.setOnConnectionChange(() => {});
      mqttService.setOnError(() => {});
      mqttService.setOnMessage(() => {});
      clearInterval(interval);
    };
  }, []);

  const handleConnect = async () => {
    try {
      addLog('Configuring MQTT with current settings...');
      mqttService.configure(settings.mqtt);
      addLog(`Connecting to ${settings.mqtt.brokerAddress}:${settings.mqtt.port}...`);
      await mqttService.connect();
    } catch (error) {
      addLog(`Connect failed: ${(error as Error).message}`);
    }
  };

  const handleDisconnect = () => {
    addLog('Disconnecting...');
    mqttService.disconnect();
  };

  const handleTestConnection = async () => {
    try {
      addLog('--- Testing with testConnection() method ---');
      addLog('Configuring MQTT with current settings...');
      mqttService.configure(settings.mqtt);
      addLog(`Config: ${settings.mqtt.brokerAddress}:${settings.mqtt.port} (${settings.mqtt.protocol.toUpperCase()})`);
      
      // Check circuit breaker first
      const cbStatus = mqttService.getCircuitBreakerStatus();
      addLog(`Circuit breaker BEFORE: ${cbStatus.isOpen ? 'OPEN' : 'CLOSED'}, failures: ${cbStatus.consecutiveFailures}`);
      
      // testConnection() should bypass circuit breaker
      addLog('Starting testConnection() method (bypasses circuit breaker)...');
      const startTime = Date.now();
      const result = await mqttService.testConnection();
      const duration = Date.now() - startTime;
      
      // Check CB status after
      const cbStatusAfter = mqttService.getCircuitBreakerStatus();
      addLog(`Circuit breaker AFTER: ${cbStatusAfter.isOpen ? 'OPEN' : 'CLOSED'}, failures: ${cbStatusAfter.consecutiveFailures}`);
      
      addLog(`testConnection() result: ${result ? '✅ SUCCESS' : '❌ FAILED'} (${duration}ms)`);
      addLog('Method: mqtt.connect() directly, bypasses custom TCP wrapper');
      
      if (!result) {
        addLog('⚠️ testConnection() failed - possible network/server issue');
      }
    } catch (error) {
      addLog(`testConnection() ERROR: ${(error as Error).message}`);
    }
  };

  const handleTestMainConnection = async () => {
    try {
      addLog('--- Testing with connect() method ---');
      addLog('Testing MAIN connection (same as main app uses)...');
      mqttService.configure(settings.mqtt);
      addLog(`Config: ${settings.mqtt.brokerAddress}:${settings.mqtt.port} (${settings.mqtt.protocol.toUpperCase()})`);
      
      // Check circuit breaker first
      const cbStatus = mqttService.getCircuitBreakerStatus();
      addLog(`Circuit breaker BEFORE: ${cbStatus.isOpen ? 'OPEN' : 'CLOSED'}, failures: ${cbStatus.consecutiveFailures}`);
      
      if (cbStatus.isOpen) {
        addLog(`connect() BLOCKED by circuit breaker (${Math.ceil(cbStatus.remainingTimeMs / 1000)}s remaining)`);
        addLog('⚠️ This is why main app connection fails when Settings test succeeds!');
        return;
      }
      
      addLog('Starting connect() method (respects circuit breaker)...');
      const startTime = Date.now();
      const result = await mqttService.connect();
      const duration = Date.now() - startTime;
      
      // Check CB status after
      const cbStatusAfter = mqttService.getCircuitBreakerStatus();
      addLog(`Circuit breaker AFTER: ${cbStatusAfter.isOpen ? 'OPEN' : 'CLOSED'}, failures: ${cbStatusAfter.consecutiveFailures}`);
      
      addLog(`connect() result: ${result ? '✅ SUCCESS' : '❌ FAILED'} (${duration}ms)`);
      addLog('Method: Custom TCP wrapper + react-native-tcp-socket + circuit breaker');
      
      if (!result) {
        addLog('⚠️ connect() failed - could be TCP wrapper issue or CB triggered');
      }
      
      // Disconnect after test to not interfere
      if (result) {
        setTimeout(() => {
          mqttService.disconnect();
          addLog('🔌 Disconnected test connection');
        }, 2000);
      }
    } catch (error) {
      addLog(`connect() ERROR: ${(error as Error).message}`);
    }
  };

  const handleCompareConnections = async () => {
    addLog('='.repeat(50));
    addLog('🔍 COMPARISON TEST: testConnection() vs connect()');
    addLog(`Server: ${settings.mqtt.brokerAddress}:${settings.mqtt.port}`);
    addLog(`Protocol: ${settings.mqtt.protocol.toUpperCase()}`);
    addLog('='.repeat(50));
    
    // Test 1: testConnection()
    await handleTestConnection();
    
    addLog(''); // separator
    addLog('⏳ Waiting 3s before next test...');
    
    // Wait a moment between tests
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test 2: connect()
    await handleTestMainConnection();
    
    addLog('');
    addLog('='.repeat(50));
    addLog('🏁 COMPARISON COMPLETE');
    addLog('Key Differences:');
    addLog('• testConnection(): Direct mqtt.connect(), fast, bypasses circuit breaker');
    addLog('• connect(): Custom TCP wrapper, slower, respects circuit breaker');
    addLog('• Settings uses testConnection() → explains why Settings always works');
    addLog('• Main app uses connect() → explains why main app gets blocked by CB');
    addLog('='.repeat(50));
  };

  const handleResetCircuitBreaker = () => {
    addLog('Resetting circuit breaker...');
    mqttService.resetCircuitBreakerManually();
    updateCircuitBreakerStatus();
  };

  const handleExportLogs = async () => {
    try {
      const exportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const deviceInfo = {
        timestamp: new Date().toISOString(),
        config: {
          server: `${settings.mqtt.brokerAddress}:${settings.mqtt.port}`,
          protocol: settings.mqtt.protocol.toUpperCase(),
          username: settings.mqtt.username || '(empty)'
        },
        circuitBreaker: circuitBreakerStatus,
        currentStatus: status,
        error: error || 'none'
      };

      const logContent = [
        '=====================================',
        'MQTT CONNECTION TEST LOG EXPORT',
        '=====================================',
        '',
        'EXPORT INFO:',
        `Export Time: ${new Date().toISOString()}`,
        `Export Filename: mqtt-test-log-${exportTimestamp}.txt`,
        '',
        'CURRENT CONFIG:',
        JSON.stringify(deviceInfo.config, null, 2),
        '',
        'CIRCUIT BREAKER STATUS:',
        JSON.stringify(deviceInfo.circuitBreaker, null, 2),
        '',
        'CURRENT CONNECTION STATUS:',
        `Status: ${deviceInfo.currentStatus}`,
        `Error: ${deviceInfo.error}`,
        '',
        '=====================================',
        'DETAILED LOGS:',
        '=====================================',
        '',
        ...detailedLogs,
        '',
        '=====================================',
        'END OF LOG EXPORT',
        '====================================='
      ].join('\n');

      await Share.share({
        message: logContent,
        title: `MQTT Test Logs - ${exportTimestamp}`,
      });
      
      addLog(`✅ Logs exported successfully (${detailedLogs.length} entries)`);
    } catch (error) {
      addLog(`❌ Export failed: ${(error as Error).message}`);
      Alert.alert('Export Failed', `Could not export logs: ${(error as Error).message}`);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    setDetailedLogs([]);
    addLog('📝 Logs cleared');
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#4CAF50';
      case 'connecting': return '#FF9800';
      case 'error': return '#F44336';
      default: return '#757575';
    }
  };

  return (
    <Card style={styles.container}>
      <Card.Content>
        <Text variant="titleMedium" style={styles.title}>
          MQTT Connection Test
        </Text>
        
        {/* Current MQTT Configuration */}
        <View style={styles.configContainer}>
          <Text variant="bodySmall" style={styles.configTitle}>
            Current MQTT Configuration:
          </Text>
          <Text variant="bodySmall" style={styles.configText}>
            Server: {settings.mqtt.brokerAddress}:{settings.mqtt.port}
          </Text>
          <Text variant="bodySmall" style={styles.configText}>
            Protocol: {settings.mqtt.protocol.toUpperCase()}
          </Text>
          <Text variant="bodySmall" style={styles.configText}>
            Username: {settings.mqtt.username || '(empty)'}
          </Text>
        </View>
        
        <View style={styles.statusContainer}>
          <Chip 
            icon="wifi" 
            style={[styles.statusChip, { backgroundColor: getStatusColor() }]}
            textStyle={{ color: 'white' }}
          >
            {status.toUpperCase()}
          </Chip>
        </View>

        {/* Circuit Breaker Status */}
        <View style={styles.circuitBreakerContainer}>
          <Text variant="bodySmall" style={styles.circuitBreakerTitle}>
            Circuit Breaker Status:
          </Text>
          <Chip 
            icon={circuitBreakerStatus.isOpen ? "lock" : "lock-open"}
            style={[
              styles.circuitBreakerChip, 
              { backgroundColor: circuitBreakerStatus.isOpen ? '#F44336' : '#4CAF50' }
            ]}
            textStyle={{ color: 'white', fontSize: 12 }}
          >
            {circuitBreakerStatus.isOpen ? 'OPEN' : 'CLOSED'}
          </Chip>
          {circuitBreakerStatus.consecutiveFailures > 0 && (
            <Text variant="bodySmall" style={styles.failuresText}>
              Failures: {circuitBreakerStatus.consecutiveFailures}
            </Text>
          )}
          {circuitBreakerStatus.isOpen && circuitBreakerStatus.remainingTimeMs > 0 && (
            <Text variant="bodySmall" style={styles.timerText}>
              Reset in: {Math.ceil(circuitBreakerStatus.remainingTimeMs / 1000)}s
            </Text>
          )}
        </View>

        {error && (
          <Text style={styles.errorText}>
            Error: {error}
          </Text>
        )}

        <View style={styles.buttonContainer}>
          <Button 
            mode="contained" 
            onPress={handleConnect}
            disabled={status === 'connecting' || status === 'connected'}
            style={styles.button}
          >
            Connect
          </Button>
          
          <Button 
            mode="outlined" 
            onPress={handleDisconnect}
            disabled={status === 'disconnected'}
            style={styles.button}
          >
            Disconnect
          </Button>
          
          <Button 
            mode="text" 
            onPress={handleTestConnection}
            style={styles.button}
          >
            Quick Test (testConnection)
          </Button>

          <Button 
            mode="text" 
            onPress={handleTestMainConnection}
            style={styles.button}
          >
            Main Test (connect)
          </Button>

          <Button 
            mode="contained" 
            onPress={handleCompareConnections}
            style={[styles.button, { backgroundColor: '#9C27B0' }]}
          >
            🔍 Compare Both Methods
          </Button>

          {circuitBreakerStatus.isOpen && (
            <Button 
              mode="contained" 
              onPress={handleResetCircuitBreaker}
              style={[styles.button, { backgroundColor: '#FF9800' }]}
              labelStyle={{ color: 'white' }}
            >
              Reset Circuit Breaker
            </Button>
          )}

          <Button 
            mode="outlined" 
            onPress={handleExportLogs}
            style={[styles.button, styles.exportButton]}
            icon="download"
          >
            📤 Export Logs
          </Button>

          <Button 
            mode="text" 
            onPress={handleClearLogs}
            style={[styles.button]}
            icon="delete"
          >
            🗑️ Clear Logs
          </Button>
        </View>

        <View style={styles.logsContainer}>
          <View style={styles.logsHeader}>
            <Text variant="labelMedium" style={styles.logsTitle}>
              Connection Logs: (Recent {logs.length}, Total {detailedLogs.length})
            </Text>
            <Text variant="bodySmall" style={styles.logsSubtitle}>
              💡 Use "Export Logs" to get full detailed logs for debugging
            </Text>
          </View>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
          {detailedLogs.length === 0 && (
            <Text style={styles.noLogsText}>
              No logs yet. Start testing to see connection logs here.
            </Text>
          )}
        </View>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  statusChip: {
    paddingHorizontal: 16,
  },
  configContainer: {
    marginVertical: 8,
    padding: 8,
    backgroundColor: '#e8f5e8',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  configTitle: {
    marginBottom: 4,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  configText: {
    color: '#388E3C',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  circuitBreakerContainer: {
    marginVertical: 8,
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
  },
  circuitBreakerTitle: {
    marginBottom: 4,
    fontWeight: 'bold',
  },
  circuitBreakerChip: {
    marginBottom: 4,
  },
  failuresText: {
    color: '#F44336',
    fontSize: 12,
  },
  timerText: {
    color: '#FF9800',
    fontSize: 12,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#F44336',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 12,
  },
  buttonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  button: {
    flex: 1,
    minWidth: '45%',
    marginHorizontal: 2,
    marginVertical: 2,
  },
  exportButton: {
    borderColor: '#2196F3',
  },
  logsContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  logsHeader: {
    marginBottom: 8,
  },
  logsTitle: {
    fontWeight: 'bold',
    marginBottom: 2,
  },
  logsSubtitle: {
    color: '#666',
    fontStyle: 'italic',
  },
  logText: {
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  noLogsText: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    marginVertical: 8,
  },
});