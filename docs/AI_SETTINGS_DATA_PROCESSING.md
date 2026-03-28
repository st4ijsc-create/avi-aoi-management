# AI Settings & Data Processing

## Overview

Two new modules added to the AI Hub for managing AI system configuration and preparing training data.

---

## 1. AI Settings (`/ai-settings`)

Centralized configuration for AI services, model parameters, and system settings. **Admin-only** access.

### Tabs

#### API Keys
- CRUD management for external AI service API keys (OpenAI, Azure OpenAI, Hugging Face, Custom)
- Keys are encrypted at rest (base64 encoded in `aiApiKeys` table)
- Test connections, toggle active/inactive status
- Endpoint configuration per provider

#### Model Configuration
- Default model selection (from registered AI models)
- Confidence threshold (0–1 range)
- Max concurrent inferences
- GPU acceleration toggle
- Auto-scale inference workers

#### System Configuration
- Master AI enable/disable switch
- Inference logging toggle
- Data retention period (days)
- Max model upload size (MB)

### API Endpoints (tRPC)

| Procedure | Access | Description |
|-----------|--------|-------------|
| `aiSettings.listApiKeys` | Admin | List all API keys (without encrypted key) |
| `aiSettings.createApiKey` | Admin | Create new API key |
| `aiSettings.deleteApiKey` | Admin | Delete API key by ID |
| `aiSettings.testApiKey` | Admin | Test API key connection |
| `aiSettings.toggleApiKey` | Admin | Toggle active/inactive |
| `aiSettings.getConfig` | Protected | Get model config |
| `aiSettings.updateConfig` | Admin | Update model config |
| `aiSettings.getSystemConfig` | Protected | Get system config |
| `aiSettings.updateSystemConfig` | Admin | Update system config |

### Database Tables

**`aiApiKeys`**
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | Auto-increment ID |
| name | varchar(100) | Display name |
| provider | enum | openai, azure_openai, huggingface, custom |
| encryptedKey | text | Encrypted API key |
| endpoint | varchar(500) | Optional endpoint URL |
| status | enum | active, inactive, expired, error |
| lastTestedAt | timestamp | Last test timestamp |
| createdBy | integer | User FK |
| createdAt/updatedAt | timestamp | Timestamps |

**`aiSystemConfig`**
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | Auto-increment ID |
| key | varchar(100) | Unique config key |
| value | text | Config value |
| description | text | Description |
| updatedBy | integer | Last update user FK |
| updatedAt | timestamp | Last update time |

---

## 2. Data Processing (`/ai-data-processing`)

Image data preparation pipeline for AI model training. Three processing stages with tab-based UI.

### Tabs

#### Data Pipeline
- Dashboard: total/processed/pending/failed image counts with progress bar
- Configuration: source directory, output directory, batch size, worker threads, output format (png/jpg/bmp/tiff)
- Run pipeline with real-time progress tracking

#### Image Preprocessing
- **Resize**: target width/height with mode selection (letterbox, stretch, center crop)
- **Color processing**: normalize (0-1), grayscale conversion, auto contrast (CLAHE)
- **Background removal**: automatic background subtraction for cleaner defect detection

#### Augmentation
- 8 augmentation types: horizontal flip, rotation, brightness, contrast, noise, random crop, resize, Gaussian blur
- Selectable via card-based UI with checkboxes
- Multiplier control (1–20x copies per original image)
- Summary showing selected augmentations and estimated output count

### API Endpoints (tRPC)

| Procedure | Access | Description |
|-----------|--------|-------------|
| `aiSettings.getDataPipelineStats` | Protected | Get pipeline statistics |
| `aiSettings.runDataPipeline` | Admin | Start data pipeline |
| `aiSettings.runAugmentation` | Admin | Run augmentation job |

---

## 3. i18n Support

All UI text is internationalized across 3 locales:
- **English** (`en.json`): `aiSettings.*`, `aiDataProcessing.*`
- **Vietnamese** (`vi.json`): Full translations
- **Chinese** (`zh.json`): Full translations

AI Hub feature cards and quick actions also translated for both new modules.

---

## 4. Navigation

Both pages are accessible from:
- **Left sidebar**: AI Analytics group → "Data Processing" and "AI Settings"
- **AI Hub** (`/ai-hub`): Feature cards + quick action buttons
- **Direct URL**: `/ai-data-processing` and `/ai-settings`

AI Settings requires admin role (`requiredRole: "admin"`).
