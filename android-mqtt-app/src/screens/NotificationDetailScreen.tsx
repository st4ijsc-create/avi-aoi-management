/**
 * Notification Detail Screen - View NG alert details with on-demand image loading
 * and reference image comparison (side-by-side)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Image,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
} from 'react-native';
import {
  Card,
  Text,
  Chip,
  Button,
  Divider,
  DataTable,
  SegmentedButtons,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getMqttConfig } from '../services/mqttService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_WIDTH = SCREEN_WIDTH - 48;
const COMPARE_IMAGE_WIDTH = (SCREEN_WIDTH - 56) / 2; // Side-by-side width

interface PointImage {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  result: string;
  measuredValue: string | null;
  imageUrl: string;
  referenceImageUrl?: string;
}

interface InspectionImagesResponse {
  success: boolean;
  inspectionId: number;
  serialNumber: string;
  overallResult: string;
  inspectionTime: string;
  totalPoints: number;
  pointsWithImages: PointImage[];
}

export default function NotificationDetailScreen({ route }: any) {
  const notification = route.params?.notification;
  const data = notification?.data;

  const [images, setImages] = useState<PointImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [fullscreenCompareImage, setFullscreenCompareImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<string>('inspection'); // 'inspection' | 'compare'

  // Extract data from the MQTT payload
  const alertId = data?.alertId || 'N/A';
  const stationName = data?.station?.name || 'N/A';
  const lineName = data?.station?.line || '';
  const areaName = data?.station?.area || '';
  const productName = data?.product?.name || 'N/A';
  const serialNumber = data?.product?.serialNumber || 'N/A';
  const model = data?.product?.model || '';
  const customer = data?.product?.customer || '';
  const errorDesc = data?.error?.description || 'N/A';
  const severity = data?.severity || 'low';
  const machineName = data?.machine?.name || 'N/A';
  const machineCode = data?.machine?.code || '';
  const ngPoints = data?.ngPoints || [];
  const totalNG = data?.totalNG || ngPoints.length;
  const inspectionId = data?.inspectionId;
  const timestamp = data?.timestamp
    ? new Date(data.timestamp).toLocaleString('vi-VN')
    : notification?.timestamp
    ? new Date(notification.timestamp).toLocaleString('vi-VN')
    : 'N/A';

  const severityColors: Record<string, string> = {
    low: '#3b82f6',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
  };

  const severityLabels: Record<string, string> = {
    low: 'Thấp',
    medium: 'Trung bình',
    high: 'Cao',
    critical: 'Nghiêm trọng',
  };

  /**
   * Fetch inspection images on-demand from server
   */
  const loadImages = useCallback(async () => {
    if (!inspectionId) {
      setImageError('Không có mã kiểm tra (inspectionId)');
      return;
    }

    setLoadingImages(true);
    setImageError(null);

    try {
      const config = await getMqttConfig();
      const serverUrl = config.serverUrl?.replace(/\/+$/, '');

      if (!serverUrl) {
        setImageError(
          'Chưa cấu hình địa chỉ Server.\nVào Cài đặt → Địa chỉ Server (HTTP) để thiết lập.',
        );
        return;
      }

      const url = `${serverUrl}/api/inspection/${inspectionId}/images`;
      console.log('[Detail] Fetching images from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Server trả về lỗi: ${response.status}`);
      }

      const result: InspectionImagesResponse = await response.json();

      if (result.success && result.pointsWithImages?.length > 0) {
        // Resolve relative imageUrl to full URL
        const resolvedImages = result.pointsWithImages.map((p) => ({
          ...p,
          imageUrl: p.imageUrl.startsWith('http')
            ? p.imageUrl
            : `${serverUrl}${p.imageUrl.startsWith('/') ? '' : '/'}${p.imageUrl}`,
          referenceImageUrl: p.referenceImageUrl
            ? p.referenceImageUrl.startsWith('http')
              ? p.referenceImageUrl
              : `${serverUrl}${p.referenceImageUrl.startsWith('/') ? '' : '/'}${p.referenceImageUrl}`
            : undefined,
        }));
        setImages(resolvedImages);
        setImagesLoaded(true);
        // Auto-switch to compare mode if any reference images exist
        if (resolvedImages.some(img => img.referenceImageUrl)) {
          setViewMode('compare');
        }
      } else {
        setImages([]);
        setImagesLoaded(true);
        setImageError('Không có ảnh cho lần kiểm tra này.');
      }
    } catch (err: any) {
      console.error('[Detail] Error loading images:', err);
      setImageError(`Lỗi tải ảnh: ${err.message}`);
    } finally {
      setLoadingImages(false);
    }
  }, [inspectionId]);

  if (!data) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Icon name="alert-circle-outline" size={64} color="#475569" />
          <Text style={styles.emptyTitle}>Không có dữ liệu</Text>
          <Text style={styles.emptyDesc}>
            Thông báo này không chứa dữ liệu chi tiết.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Alert Header */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.headerRow}>
              <Icon name="alert-octagon" size={28} color={severityColors[severity]} />
              <View style={styles.headerText}>
                <Text style={styles.alertId}>{alertId}</Text>
                <Text style={styles.timestamp}>{timestamp}</Text>
              </View>
              <Chip
                style={[styles.severityChip, { backgroundColor: severityColors[severity] + '30' }]}
                textStyle={[styles.severityChipText, { color: severityColors[severity] }]}
              >
                {severityLabels[severity] || severity}
              </Chip>
            </View>
          </Card.Content>
        </Card>

        {/* Station & Machine Info */}
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>
              <Icon name="factory" size={16} color="#14b8a6" /> Thiết bị & Vị trí
            </Text>
            <Divider style={styles.divider} />
            <InfoRow label="Trạm" value={stationName} />
            {lineName ? <InfoRow label="Chuyền" value={lineName} /> : null}
            {areaName ? <InfoRow label="Khu vực" value={areaName} /> : null}
            <InfoRow label="Máy" value={`${machineName}${machineCode ? ` (${machineCode})` : ''}`} />
          </Card.Content>
        </Card>

        {/* Product Info */}
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>
              <Icon name="package-variant" size={16} color="#14b8a6" /> Sản phẩm
            </Text>
            <Divider style={styles.divider} />
            <InfoRow label="Tên SP" value={productName} />
            <InfoRow label="S/N" value={serialNumber} />
            {model ? <InfoRow label="Model" value={model} /> : null}
            {customer ? <InfoRow label="Khách hàng" value={customer} /> : null}
          </Card.Content>
        </Card>

        {/* Error Description */}
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>
              <Icon name="bug" size={16} color="#ef4444" /> Mô tả lỗi
            </Text>
            <Divider style={styles.divider} />
            <Text style={styles.errorDesc}>{errorDesc}</Text>
          </Card.Content>
        </Card>

        {/* NG Points Table */}
        {ngPoints.length > 0 && (
          <Card style={styles.card}>
            <Card.Content>
              <Text style={styles.sectionTitle}>
                <Icon name="format-list-checks" size={16} color="#f59e0b" /> Điểm NG ({totalNG})
              </Text>
              <Divider style={styles.divider} />
              <DataTable>
                <DataTable.Header>
                  <DataTable.Title textStyle={styles.tableHeader}>Điểm đo</DataTable.Title>
                  <DataTable.Title textStyle={styles.tableHeader}>Kết quả</DataTable.Title>
                  <DataTable.Title textStyle={styles.tableHeader}>Giá trị</DataTable.Title>
                  <DataTable.Title textStyle={styles.tableHeader}>Kỳ vọng</DataTable.Title>
                </DataTable.Header>
                {ngPoints.map((point: any, index: number) => (
                  <DataTable.Row key={index}>
                    <DataTable.Cell textStyle={styles.tableCell}>
                      {point.pointName || point.pointCode}
                    </DataTable.Cell>
                    <DataTable.Cell>
                      <Chip
                        style={styles.ngChip}
                        textStyle={styles.ngChipText}
                      >
                        {point.result}
                      </Chip>
                    </DataTable.Cell>
                    <DataTable.Cell textStyle={styles.tableCell}>
                      {point.actualValue || '-'}
                    </DataTable.Cell>
                    <DataTable.Cell textStyle={styles.tableCell}>
                      {point.expectedValue || '-'}
                    </DataTable.Cell>
                  </DataTable.Row>
                ))}
              </DataTable>
            </Card.Content>
          </Card>
        )}

        {/* Image Section */}
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>
              <Icon name="camera" size={16} color="#06b6d4" /> Ảnh kiểm tra
            </Text>
            <Divider style={styles.divider} />

            {!imagesLoaded && !loadingImages && (
              <View style={styles.imageActionContainer}>
                <Text style={styles.imageHint}>
                  Ảnh sẽ được tải từ server khi bạn bấm nút bên dưới.
                </Text>
                <Button
                  mode="contained"
                  icon="image-multiple"
                  onPress={loadImages}
                  style={styles.loadImagesButton}
                  labelStyle={styles.loadImagesLabel}
                  disabled={!inspectionId}
                >
                  Xem ảnh ({inspectionId ? `#${inspectionId}` : 'N/A'})
                </Button>
                {!inspectionId && (
                  <Text style={styles.imageErrorText}>
                    Không có inspectionId trong bản tin.
                  </Text>
                )}
              </View>
            )}

            {loadingImages && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#14b8a6" />
                <Text style={styles.loadingText}>Đang tải ảnh từ server...</Text>
              </View>
            )}

            {imageError && (
              <View style={styles.imageErrorContainer}>
                <Icon name="image-broken-variant" size={32} color="#ef4444" />
                <Text style={styles.imageErrorText}>{imageError}</Text>
                <Button
                  mode="outlined"
                  onPress={loadImages}
                  style={styles.retryButton}
                  labelStyle={styles.retryLabel}
                >
                  Thử lại
                </Button>
              </View>
            )}

            {/* View mode toggle: Inspection only vs Compare side-by-side */}
            {imagesLoaded && images.length > 0 && images.some(img => img.referenceImageUrl) && (
              <View style={styles.viewModeContainer}>
                <SegmentedButtons
                  value={viewMode}
                  onValueChange={setViewMode}
                  buttons={[
                    {
                      value: 'inspection',
                      label: 'Ảnh kiểm tra',
                      icon: 'image',
                    },
                    {
                      value: 'compare',
                      label: 'So sánh mẫu',
                      icon: 'compare',
                    },
                  ]}
                  style={styles.segmentedButtons}
                />
              </View>
            )}

            {/* === VIEW MODE: Inspection Images Only === */}
            {imagesLoaded && images.length > 0 && viewMode === 'inspection' && (
              <View style={styles.imagesContainer}>
                {images.map((img, idx) => (
                  <View key={idx} style={styles.imageItem}>
                    <View style={styles.imageLabel}>
                      <Chip
                        style={styles.pointChip}
                        textStyle={styles.pointChipText}
                      >
                        {img.pointCode}
                      </Chip>
                      <Text style={styles.pointName}>{img.pointName}</Text>
                      <Chip
                        style={[
                          styles.resultChip,
                          img.result === 'NG' ? styles.ngChip : styles.okChip,
                        ]}
                        textStyle={styles.resultChipText}
                      >
                        {img.result}
                      </Chip>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setFullscreenImage(img.imageUrl)}
                    >
                      <Image
                        source={{ uri: img.imageUrl }}
                        style={styles.inspectionImage}
                        resizeMode="contain"
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* === VIEW MODE: Side-by-Side Comparison === */}
            {imagesLoaded && images.length > 0 && viewMode === 'compare' && (
              <View style={styles.imagesContainer}>
                {images.map((img, idx) => (
                  <View key={idx} style={styles.imageItem}>
                    <View style={styles.imageLabel}>
                      <Chip
                        style={styles.pointChip}
                        textStyle={styles.pointChipText}
                      >
                        {img.pointCode}
                      </Chip>
                      <Text style={styles.pointName}>{img.pointName}</Text>
                      <Chip
                        style={[
                          styles.resultChip,
                          img.result === 'NG' ? styles.ngChip : styles.okChip,
                        ]}
                        textStyle={styles.resultChipText}
                      >
                        {img.result}
                      </Chip>
                    </View>

                    {/* Side-by-side comparison row */}
                    <View style={styles.compareRow}>
                      {/* Reference Image (Left) */}
                      <View style={styles.compareColumn}>
                        <Text style={styles.compareLabel}>
                          <Icon name="star-outline" size={12} color="#fbbf24" /> Ảnh mẫu
                        </Text>
                        {img.referenceImageUrl ? (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() => {
                              setFullscreenImage(img.referenceImageUrl!);
                              setFullscreenCompareImage(img.imageUrl);
                            }}
                          >
                            <Image
                              source={{ uri: img.referenceImageUrl }}
                              style={styles.compareImage}
                              resizeMode="contain"
                            />
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.noRefImageContainer}>
                            <Icon name="image-off-outline" size={28} color="#475569" />
                            <Text style={styles.noRefImageText}>Chưa có ảnh mẫu</Text>
                          </View>
                        )}
                      </View>

                      {/* Actual Inspection Image (Right) */}
                      <View style={styles.compareColumn}>
                        <Text style={styles.compareLabel}>
                          <Icon name="camera" size={12} color="#06b6d4" /> Ảnh thực tế
                        </Text>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => {
                            setFullscreenImage(img.imageUrl);
                            setFullscreenCompareImage(img.referenceImageUrl || null);
                          }}
                        >
                          <Image
                            source={{ uri: img.imageUrl }}
                            style={styles.compareImage}
                            resizeMode="contain"
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {imagesLoaded && images.length === 0 && !imageError && (
              <View style={styles.noImagesContainer}>
                <Icon name="image-off" size={48} color="#475569" />
                <Text style={styles.noImagesText}>
                  Không có ảnh nào cho lần kiểm tra này.
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Fullscreen Image Modal with comparison toggle */}
      <Modal
        visible={!!fullscreenImage}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setFullscreenImage(null);
          setFullscreenCompareImage(null);
        }}
      >
        <View style={styles.modalBackground}>
          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => {
              setFullscreenImage(null);
              setFullscreenCompareImage(null);
            }}
          >
            <Icon name="close-circle" size={36} color="#ffffff" />
          </TouchableOpacity>
          {fullscreenImage && (
            <>
              {/* Label indicating which image is shown */}
              <View style={styles.fullscreenLabelContainer}>
                <Text style={styles.fullscreenLabel}>
                  {fullscreenCompareImage
                    ? fullscreenImage === fullscreenCompareImage
                      ? '📋 Ảnh mẫu (Reference)'
                      : '📷 Ảnh thực tế (Actual)'
                    : '📷 Ảnh kiểm tra'}
                </Text>
              </View>

              <Image
                source={{ uri: fullscreenImage }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />

              {/* Toggle button to swap between reference and actual */}
              {fullscreenCompareImage && (
                <TouchableOpacity
                  style={styles.fullscreenToggleButton}
                  onPress={() => {
                    // Swap: if currently showing actual, show reference and vice versa
                    if (fullscreenImage !== fullscreenCompareImage) {
                      // Currently showing actual → switch to reference
                      setFullscreenImage(fullscreenCompareImage);
                    } else {
                      // Currently showing reference → switch back to actual
                      // We need to find the original actual image
                      // Store it via the compare image swap logic
                      const actualImg = images.find(
                        (img) => img.referenceImageUrl === fullscreenCompareImage,
                      );
                      if (actualImg) {
                        setFullscreenImage(actualImg.imageUrl);
                      }
                    }
                  }}
                >
                  <Icon name="swap-horizontal" size={20} color="#ffffff" />
                  <Text style={styles.fullscreenToggleText}>
                    {fullscreenImage !== fullscreenCompareImage
                      ? 'Xem ảnh mẫu'
                      : 'Xem ảnh thực tế'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

/** Small info row component */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 32,
  },
  card: {
    marginBottom: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  alertId: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  timestamp: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  severityChip: {
    borderRadius: 8,
  },
  severityChipText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  divider: {
    backgroundColor: '#334155',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  infoLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  infoValue: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  errorDesc: {
    color: '#fbbf24',
    fontSize: 14,
    lineHeight: 20,
  },
  tableHeader: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  tableCell: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  ngChip: {
    backgroundColor: '#7f1d1d',
    height: 22,
  },
  ngChipText: {
    color: '#fca5a5',
    fontSize: 10,
  },
  okChip: {
    backgroundColor: '#14532d',
  },
  resultChip: {
    height: 22,
  },
  resultChipText: {
    color: '#ffffff',
    fontSize: 10,
  },
  pointChip: {
    backgroundColor: '#1e3a5f',
    height: 24,
    marginRight: 8,
  },
  pointChipText: {
    color: '#93c5fd',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  imageActionContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  imageHint: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  loadImagesButton: {
    backgroundColor: '#14b8a6',
    borderRadius: 8,
  },
  loadImagesLabel: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 13,
  },
  imageErrorContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  imageErrorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  retryButton: {
    borderColor: '#14b8a6',
  },
  retryLabel: {
    color: '#14b8a6',
  },
  imagesContainer: {
    marginTop: 4,
  },
  imageItem: {
    marginBottom: 16,
  },
  imageLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  pointName: {
    color: '#e2e8f0',
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  inspectionImage: {
    width: IMAGE_WIDTH,
    height: IMAGE_WIDTH * 0.75,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  noImagesContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noImagesText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
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
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 48,
    right: 24,
    zIndex: 10,
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
  // Reference image comparison styles
  viewModeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  segmentedButtons: {
    backgroundColor: '#334155',
    borderRadius: 8,
  },
  compareRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  compareColumn: {
    flex: 1,
  },
  compareLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  compareImage: {
    width: COMPARE_IMAGE_WIDTH,
    height: COMPARE_IMAGE_WIDTH * 0.75,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
  noRefImageContainer: {
    width: COMPARE_IMAGE_WIDTH,
    height: COMPARE_IMAGE_WIDTH * 0.75,
    borderRadius: 6,
    backgroundColor: '#1a2332',
    borderWidth: 1,
    borderColor: '#334155',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noRefImageText: {
    color: '#475569',
    fontSize: 11,
    marginTop: 4,
  },
  fullscreenLabelContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  fullscreenLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  fullscreenToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,184,166,0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    marginTop: 24,
    gap: 8,
  },
  fullscreenToggleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
