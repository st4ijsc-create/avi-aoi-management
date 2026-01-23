# AVI/AOI Factory Management System - TODO

## Phase 1: Database Schema & Core Setup
- [x] Design and implement database schema (factories, workshops, lines, stations, machines, products, measurements, images)
- [x] Setup global theming with elegant and perfect design style
- [x] Configure dark theme with industrial professional color palette

## Phase 2: API Endpoints
- [x] Create API endpoint for machine data submission (POST /api/machine/submit)
- [x] Create API endpoint for image upload from machines (POST /api/machine/upload-image)
- [x] Create API endpoint for batch data submission
- [x] Implement API authentication with API keys for machines
- [x] Create API documentation for external machine integration

## Phase 3: Dashboard Realtime
- [x] Build main dashboard with Total Product, OK/NG/NTF, Yield Rate statistics
- [x] Implement realtime data refresh mechanism
- [x] Create machine status cards with live metrics
- [x] Add time-based filtering (today, week, month, custom range)
- [x] Implement factory/workshop/line filtering

## Phase 4: History & Search Module
- [x] Build search interface with filters (factory, workshop, SN, line, station, machine)
- [x] Create product list with pagination
- [x] Implement product detail view with all measurement points
- [x] Display measurement images with zoom capability
- [x] Show measurement values, standards, and OK/NG results
- [x] Add remark/note functionality for measurement points

## Phase 5: AI Analysis & NTF Confirmation
- [x] Integrate AI image analysis for measurement point evaluation
- [x] Build image comparison view (actual vs reference image)
- [x] Implement NTF confirmation workflow (mark NG as Not True Fail)
- [x] Create NTF history and statistics
- [x] Add AI-assisted defect detection suggestions

## Phase 6: 2D/3D Layout Visualization
- [x] Create layout designer for factory floor plan
- [x] Implement 2D layout view with machine positions
- [x] Add 3D visualization mode with Three.js
- [x] Display machine metrics on layout (Total, OK/NG/NTF, Yield)
- [x] Enable click-to-view machine details from layout
- [x] Support multiple factory/workshop layouts

## Phase 7: Polish & Testing
- [x] Refine UI with elegant and perfect design principles
- [x] Add smooth animations and transitions
- [x] Implement responsive design for different screen sizes
- [x] Write unit tests for API endpoints
- [x] Write unit tests for core business logic
- [x] Performance optimization for large datasets

## Phase 8: Documentation & Delivery
- [x] Create API documentation with examples
- [x] Write user guide for dashboard and modules
- [x] Document layout designer usage
- [x] Prepare system architecture documentation

## Phase 9: Product & Measurement Point Management
- [x] Create product model table with reference image
- [x] Create measurement point definition table with coordinates on reference image
- [x] Build product management UI with image upload
- [x] Implement measurement point editor (draw circles on reference image)
- [x] Support 30-50 measurement points per product
- [x] Store reference images for each measurement point
- [x] Link measurement points to inspection results

## Phase 10: Enterprise Scale Optimization
- [x] Optimize database indexing for multi-factory queries
- [x] Implement data partitioning strategy for large datasets
- [x] Add factory/workshop hierarchy caching
- [x] Create efficient search with composite indexes
- [x] Implement data archiving for old inspection records

## Phase 11: Enterprise Layout 2D/3D
- [x] Create corporation-level layout view
- [x] Implement factory overview with workshop cards
- [x] Add Three.js 3D visualization for factory layout
- [x] Create interactive 3D machine positioning
- [x] Display realtime metrics on 3D layout
- [x] Support drill-down from corporation to machine level

## Phase 12: Sample Data & API Integration
- [x] Create sample factories (3 factories)
- [x] Create sample workshops (2-4 per factory)
- [x] Create sample production lines and stations
- [x] Create sample machines with API keys
- [x] Create sample products with measurement points
- [x] Generate sample inspection data for testing
- [x] Document API integration workflow

## Phase 13: Enhanced History Module
- [x] Update inspection detail to show reference image comparison
- [x] Implement side-by-side image comparison view
- [x] Add AI analysis for actual vs reference image
- [x] Display measurement point overlay on images
- [x] Show measurement point coordinates and results

## Bug Fixes
- [x] Fix Product Model create - upload image to S3 before saving to database instead of saving base64 directly

## Phase 14: CRUD Enhancement & History Module Upgrade

### CRUD Enhancement
- [x] Complete CRUD for Factory (create, read, update, delete with UI)
- [x] Complete CRUD for Workshop (create, read, update, delete with UI)
- [x] Complete CRUD for Production Line (create, read, update, delete with UI)
- [x] Complete CRUD for Station (create, read, update, delete with UI)
- [x] Complete CRUD for Machine (create, read, update, delete with UI)
- [x] Complete CRUD for Product Model (create, read, update, delete with UI)
- [x] Complete CRUD for Measurement Point Definition (create, read, update, delete with UI)

### History Module Upgrade
- [x] Display measurement points on product image with status colors (OK=Green, NG=Red, NTF=Orange)
- [x] Show measurement point numbers on image overlay
- [x] Click on measurement point to view detail (actual image vs reference image)
- [x] Allow user to correct result (change OK/NG/NTF) and save
- [x] Side-by-side comparison view for actual vs reference image
- [x] Display measurement values and standards in detail view

### API Testing
- [x] Test POST /api/machine/submit-inspection with sample data
- [x] Verify data flow from machine to database
- [x] Test image upload and storage

## Phase 15: API Testing, CRUD Enhancement & Excel Export

### API Testing
- [x] Test POST /api/machine/submit-inspection with sample data using curl/Postman
- [x] Verify inspection data saved correctly in database
- [x] Test image upload endpoint with sample images
- [x] Verify API key authentication works correctly

### CRUD Enhancement for Settings
- [x] Add Edit button for Factory with edit dialog
- [x] Add Delete button for Factory with confirmation
- [x] Add Edit button for Workshop with edit dialog
- [x] Add Delete button for Workshop with confirmation
- [x] Add Edit button for Production Line with edit dialog
- [x] Add Delete button for Production Line with confirmation
- [x] Add Edit button for Station with edit dialog
- [x] Add Delete button for Station with confirmation
- [x] Add Edit button for Machine with edit dialog
- [x] Add Delete button for Machine with confirmation

### Excel Export
- [x] Add Export Excel button in History page
- [x] Generate CSV file with inspection data (SN, machine, results, timestamps)
- [x] Include all relevant fields in export
- [x] UTF-8 support for Vietnamese characters


## Phase 16: Advanced Features

### Inspection Detail Layout Upgrade
- [x] Redesign inspection detail page with 2-column layout
- [x] Left column: Reference image with measurement points overlay showing actual results (OK=Green, NG=Red, NTF=Orange)
- [x] Right column: List of measurement points with detailed results (current layout)
- [x] Click on measurement point to highlight and show detail

### History Analysis Tab
- [x] Add Analysis tab in History module
- [x] Aggregate statistics for filtered products (Total, OK, NG, NTF, Yield Rate)
- [x] Charts showing result distribution
- [x] Trend analysis for selected time range
- [ ] Top NG measurement points analysis

### Product CRUD Enhancement

- [x] Complete Edit functionality for Product Model
- [x] Complete Delete functionality for Product Model
- [x] Advanced measurement point editor with drag-and-drop
- [ ] Bulk import/export measurement points
- [x] Clone product model functionality (duplicate point)
### Reports & Statistics Module
- [x] Create dedicated Reports page
- [x] Yield Rate trend chart (daily/weekly/monthly)
- [x] Machine comparison charts
- [x] Factory/Workshop performance comparison
- [x] Export reports to CSV/Excel

### WebSocket Realtime Notifications
- [x] Setup Socket.io server integration
- [x] Real-time NG product alerts
- [x] Yield rate warning when below threshold
- [x] Dashboard stats auto-refresh
- [x] Notification center in header

## Bug Fixes - Phase 17

- [x] Fix API limit validation error in Products page (limit > 100)


## Phase 18: API Optimization & Caching

### API Limit Enhancement
- [x] Increase API limit from 100 to 1000 in server/routers.ts
- [x] Update History.tsx to use higher limit for analysis

### Infinite Scroll for Analysis
- [x] Add infinite scroll/load more for analysis tab
- [x] Progressive data loading for large datasets

### Statistics Caching
- [x] Add server-side caching for statistics queries
- [x] Implement cache invalidation on new inspection data
- [x] Configurable cache TTL (default 5 minutes)


## Phase 19: Dashboard & History Major Upgrade

### Dashboard Upgrade - Production Line Layout
- [x] Redesign Dashboard with production line layout view
- [x] Display machines organized by production line
- [x] Show FPY (First Pass Yield) for each machine
- [x] Show FY (Fail Yield) for each machine
- [x] Show NTFY (NTF Yield) for each machine
- [x] Show Total Output for each machine
- [x] Machine detail modal with comprehensive info
- [x] Top recent inspection results in machine detail
- [x] Real-time status indicators for machines
- [x] Production line summary statistics

### History Upgrade - SPC Analysis
- [x] Add SPC tab in History module
- [x] Control Chart (X-bar, R chart) for measurement trends
- [x] Histogram for distribution analysis
- [x] Pareto Chart for defect analysis
- [x] Cp/Cpk calculation and display
- [x] UCL/LCL/CL lines on control charts
- [x] Out-of-control point detection
- [x] SPC rules violation alerts (Western Electric rules)

### History Upgrade - AI Analysis
- [ ] AI-powered trend prediction
- [ ] Anomaly detection with machine learning
- [ ] Root cause analysis suggestions
- [ ] Quality improvement recommendations
- [ ] Defect pattern recognition
- [ ] Correlation analysis between measurement points

### Sample Data Generation
- [x] Generate comprehensive inspection data (1000+ records)
- [x] Include various OK/NG/NTF results distribution
- [x] Create realistic measurement values with variations
- [x] Link inspections to existing machines and products
- [x] Generate data across multiple days for trend analysis
- [x] Add seed inspection data button in Settings page


## Bug Fixes - Phase 20

- [x] Fix HTML nesting error: <p> cannot contain nested <div> in History page
- [x] Fix NaN CSS left value error in InspectionDetail page


## Phase 21: Advanced Features

### Date Filter & Status Filter for History
- [x] Add date range picker (from date - to date) in History filter
- [x] Add quick date range options (today, 7 days, 30 days, custom)
- [x] Update API to support date range filtering
- [x] Integrate date picker with search functionality

### Top NG Measurement Points Analysis
- [x] Create API to aggregate NG count by measurement point
- [x] Build Top NG measurement points chart in Analysis tab
- [x] Show measurement point name, NG count, and percentage
- [x] Visual progress bar showing percentage of total NG
### AI Analysis - Trend Prediction & Anomaly Detection
- [x] Implement trend prediction using linear regression
- [x] Add anomaly detection based on statistical methods (Z-score)
- [x] Create AI Analysis tab in History module
- [x] Display predictions chart for next 7 days
- [x] Show anomaly alerts with severity levels
- [x] Generate recommendations based on analysis
- [x] Statistics overview (mean, stdDev, min, max, current)recommendations

### Email/SMS Alerts
- [x] Create alert configuration UI (new /alerts page)
- [x] Set yield rate threshold for alerts
- [x] Implement alert trigger logic in backend
- [x] Send notification when yield rate drops below threshold
- [x] Create alert history log
- [x] Alert CRUD operations (create, update, delete)
- [x] Toggle active/inactive alerts
- [x] Acknowledge alerts in history
- [x] Test notification functionality


## Phase 22: Professional Upgrade - Dashboard & History + Enterprise Modules

### Dashboard Module Evaluation & Upgrade
- [x] **Current Assessment**: Evaluate existing Dashboard features (Score: 7/10)
- [x] Add Real-time auto-refresh with configurable interval (5s, 10s, 30s, 1m)
- [x] Add KPI Cards with trend indicators (↑↓) and comparison to yesterday/last week
- [x] Add Production Summary by Factory/Workshop with drill-down
- [x] Add Shift-based statistics (Morning/Afternoon/Night shifts)
- [ ] Add Machine Utilization Rate (OEE - Overall Equipment Effectiveness)
- [x] Add Top 5 Best/Worst performing machines ranking
- [x] Add Quick Actions panel (Alert badge with count)
- [x] Add Mini charts in KPI cards showing 7-day trend (Sparklines)
- [x] Add Last update timestamp display

### History Module Evaluation & Upgrade
- [x] **Current Assessment**: Evaluate existing History features (Score: 7.5/10)
- [x] Add date range filter with quick options (today, 7 days, 30 days, custom)
- [x] Add Saved filters/presets for quick access
- [ ] Add Comparison mode (compare 2 time periods)
- [ ] Add Batch operations (bulk export, bulk acknowledge)
- [ ] Add Inspection image gallery view
- [ ] Add Defect classification breakdown
- [ ] Add Export to PDF with charts
- [ ] Add Search history/recent searches
- [x] Add Column customization (show/hide columns)
- [x] Improve pagination with page size selector (10/20/50/100)

### Products Module - Enterprise Scale
- [x] Add Product hierarchy (Category > Product Line > Variant)
- [x] Add Product lifecycle status (Development, Active, EOL, Archived)
- [ ] Add Measurement point templates for quick setup
- [ ] Add Product comparison view
- [ ] Add Import/Export product definitions (Excel/JSON)
- [ ] Add Product documentation attachments
- [x] Add Quality targets per product (Target Yield Rate, Min Yield Rate)

### Reports Module - Comprehensive Analytics
- [x] Add Executive Summary dashboard with KPIs, circular progress, recommendations
- [x] Add Factory comparison report with ranking table
- [ ] Add Trend analysis report (weekly/monthly/quarterly)
- [ ] Add Quality cost analysis
- [ ] Add Pareto analysis by defect type
- [ ] Add Scheduled report generation
- [ ] Add Report templates (Daily, Weekly, Monthly)
- [ ] Add Export to PDF/Excel with branding

### Corporate Layout Module - Enterprise View
- [x] Add Interactive world map with factory locations (SVG map with markers)
- [x] Add Factory cards with live KPIs
- [x] Add Drill-down from Corporation > Factory > Workshop > Line
- [x] Add Real-time status aggregation (color-coded by yield rate)
- [x] Add 2D/3D/MAP view modes with zoom controls
- [ ] Add Capacity utilization visualization
- [ ] Add Alert summary by region/factory


## Bug Fixes - Phase 23

- [x] Fix SQL query error: DATE() function in GROUP BY not compatible with TiDB (use DATE_FORMAT with alias)
- [x] Fix SQL query error: CASE expression in GROUP BY not compatible with TiDB (use alias)


## Phase 24: System Review & Completion

### 1. Rà soát hệ thống hiện tại
- [x] Review database schema và relationships (13 tables)
- [x] Review existing CRUD operations (Factory, Workshop, Line, Station, Machine, ProductModel, MeasurementPoint)
- [ ] Identify and fix missing features and bugs

### 2. Dữ liệu cơ bản (Master Data) - ĐÃ CÓ
- [x] Factory CRUD - Quản lý nhà máy (Settings page)
- [x] Workshop CRUD - Quản lý xưởng sản xuất (Settings page)
- [x] Production Line CRUD - Quản lý dây chuyền (Settings page)
- [x] Station CRUD - Quản lý trạm/vị trí (Settings page)
- [x] Machine CRUD - Quản lý máy AVI/AOI (Settings page)
- [x] User/Role Management - Phân quyền admin/user (schema có, UI cần bổ sung)

### 3. Products & Measurement Points - ĐÃ CÓ
- [x] Product Model CRUD - Quản lý model sản phẩm (ProductModels page)
- [x] Measurement Point Definition CRUD - Định nghĩa điểm đo với canvas editor
- [x] Product-Machine Mapping - Gán sản phẩm cho máy (/product-mapping page)

### 4. API Integration & Mapping - ĐÃ CÓ
- [x] External API endpoints for machine data (machineApiRouter.submitInspection)
- [x] Webhook receivers for inspection results (machineApiRouter)
- [x] API key management (auto-generated per machine)
- [x] Data validation and error handling (Zod schemas)
- [x] API Documentation page improvements (đầy đủ với tabs, examples, error handling)

### 5. Dashboard & History - ĐÃ CÓ
- [x] Real-time data display (auto-refresh, WebSocket)
- [x] Historical data query (searchInspections)
- [x] Export functionality (Excel export)
- [x] Advanced filtering and search
- [x] PDF Export for History (cần thêm - placeholder)

### 6. Reports & Analytics - ĐÃ CÓ
- [x] Daily/Weekly/Monthly report (Reports page)
- [x] Trend analysis charts (Recharts)
- [x] Comparative analysis (Executive Summary)
- [x] Export reports to PDF/Excel (Xuất báo cáo button có sẵn)

### 7. CẦN BỔ SUNG
- [x] User Management UI - Quản lý người dùng và phân quyền (/users page)
- [x] Product-Machine Mapping UI - Gán sản phẩm cho máy (/product-mapping page)
- [x] Shift Configuration - Cấu hình ca làm việc (Settings > Ca làm việc tab)
- [x] NTF Confirmation workflow - Xác nhận NTF với lý do (đã có trong InspectionDetail)
- [ ] Batch Operations - Xử lý hàng loạt
- [ ] PDF Export cho History và Reports


## Phase 25: Layout Nhà xưởng, Lệnh sản xuất & Machine-Product Mapping

### 1. Layout Nhà xưởng
- [x] Trực quan hóa layout nhà xưởng với vị trí máy (đã có trong Layout page)
- [x] Thêm liên kết xem layout từ Tập đoàn (CorporateLayout -> Layout)
- [x] CRUD cho vị trí máy trong layout (Settings page)
- [ ] Drag & drop để sắp xếp máy trong layout
- [x] Zoom và pan cho layout lớn (đã có)

### 2. Lệnh sản xuất (Production Order)
- [x] Tạo bảng productionOrders trong schema
- [x] CRUD cho lệnh sản xuất (/production-orders page)
- [x] Liên kết lệnh sản xuất với dây chuyền và sản phẩm
- [x] Thêm mã công ty, mã nhà xưởng, mã dây chuyền vào API
- [x] Trạng thái lệnh sản xuất (PENDING, IN_PROGRESS, COMPLETED, CANCELLED)

### 3. Gán sản phẩm theo dây chuyền
- [x] Cập nhật mapping theo dây chuyền (lineProductAssignments table)
- [x] Thêm công đoạn (stages) cho dây chuyền (lineStages table)
- [x] Liên kết công đoạn với station/machine
- [ ] Hiển thị quy trình sản xuất theo công đoạn (UI cần thêm)

### 4. Machine-Product Mapping (1 máy -> nhiều sản phẩm)
- [x] Schema đã hỗ trợ 1 máy map nhiều sản phẩm (productMachineMappings)
- [x] UI hiển thị danh sách sản phẩm theo máy (/product-mapping)
- [x] API submitInspection đã hỗ trợ productionOrderCode, companyCode, workshopCode


## Phase 26: UI Công đoạn, Gantt Chart, Barcode Scanner

### 1. UI Công đoạn dây chuyền
- [ ] Thêm tab Công đoạn trong Settings page
- [ ] CRUD cho công đoạn (tên, mã, thứ tự, mô tả)
- [ ] Drag-drop để sắp xếp thứ tự công đoạn
- [ ] Liên kết công đoạn với dây chuyền

### 2. Gantt Chart cho Lệnh sản xuất
- [ ] Thêm tab Gantt trong Production Orders page
- [ ] Hiển thị timeline các lệnh sản xuất theo dây chuyền
- [ ] Color-coded theo trạng thái (pending, in_progress, completed)
- [ ] Zoom in/out timeline (ngày/tuần/tháng)

### 3. Barcode/QR Scanner
- [ ] Tích hợp camera scanner trong History page
- [ ] Quét mã vạch/QR để tra cứu serial number
- [ ] Hiển thị kết quả kiểm tra ngay sau khi quét
- [ ] Hỗ trợ nhập thủ công nếu không quét được

## Phase 27: Gantt Chart & Barcode Scanner

### Gantt Chart cho Lệnh sản xuất
- [x] Tạo component GanttChart với timeline view
- [x] Hiển thị lệnh sản xuất theo dây chuyền
- [x] Color-coded theo trạng thái (pending=yellow, in_progress=blue, completed=green, paused=orange, cancelled=red)
- [x] Zoom in/out timeline (ngày/tuần/tháng)
- [x] Filter theo nhà máy và dây chuyền
- [x] Hiển thị progress bar trên mỗi order
- [x] Click order để mở edit dialog
- [x] Thêm tab Gantt Chart trong Production Orders page

### Barcode/QR Scanner cho History
- [x] Tạo component BarcodeScanner với html5-qrcode library
- [x] Hỗ trợ camera scanner mode
- [x] Hỗ trợ nhập thủ công serial number
- [x] Tích hợp vào History page với nút quét bên cạnh Serial Number input
- [x] Auto-fill serial number sau khi quét thành công
- [x] Toast notification khi quét thành công


## Phase 28: Layout Workshop & Dashboard UI Improvements

### Layout Workshop Enhancement
- [ ] CRUD cho Layout Workshop (thêm/sửa/xóa dây chuyền, máy, công trạm)
- [ ] Drag-drop để sắp xếp dây chuyền trong nhà xưởng
- [ ] Drag-drop để sắp xếp máy móc trong dây chuyền
- [x] Drag-drop để sắp xếp máy trong layout
- [ ] Hiển thị công đoạn của công trạm
- [x] Hiển thị thông số cho layout 2D (FPY, FY, NTFY, Output)
- [x] Hiển thị thông số cho layout 3D

### Machine Image Support
- [x] Thêm trường image2D và image3D cho Machine trong schema
- [x] Upload ảnh 2D khi thêm/sửa máy
- [x] Upload ảnh 3D khi thêm/sửa máy
- [x] Hiển thị ảnh máy trong Layout

### Dashboard UI Improvements
- [x] Di chuyển Layout dây chuyền sản xuất xuống dưới cùng
- [x] Hiển thị ảnh 2D/3D của máy trong Dashboard
- [x] Hiển thị metrics (FPY, FY, NTFY, Output) phía trên ảnh máy
- [x] Thiết kế UI hiện đại và trực quan hơn


## Phase 29: Dashboard Layout Position & Stage Display & Sample Images
- [x] Di chuyển Layout dây chuyền sản xuất xuống cuối Dashboard
- [x] Thêm hiển thị công đoạn (stages) cho công trạm trong Layout
- [x] Upload ảnh máy mẫu 2D cho các máy AVI
- [x] Upload ảnh máy mẫu 2D cho các máy AOI
- [x] Kiểm tra hiển thị ảnh trong Layout và Dashboard


## Phase 30: Dashboard Line Info, 3D Images, Stages & Multi-Workshop Layouts
- [x] Thêm mã sản phẩm và lệnh sản xuất vào title dây chuyền trên Dashboard
- [x] Tìm và upload ảnh 3D cho các máy AVI/AOI
- [x] Cập nhật database với ảnh 3D cho máy
- [x] Gán công đoạn cho công trạm trong Settings
- [x] Tạo layout cho xưởng SMT
- [x] Tạo layout cho xưởng Testing
- [x] Kiểm tra hiển thị 3D trong Layout


## Phase 31: Dashboard UI Overhaul & Data Setup
- [ ] Cải tiến UI machine card theo mẫu (ảnh máy lớn, metrics overlay phía trên)
- [ ] Thêm biểu đồ timeline FPY/FY/NTFY/Total theo thời gian thực
- [ ] Tối ưu hiển thị các biểu đồ trên màn hình
- [ ] Gán sản phẩm cho dây chuyền
- [ ] Tạo lệnh sản xuất cho dây chuyền
- [ ] Thêm máy vào layout SMT
- [ ] Thêm máy vào layout Testing
- [ ] Tạo công đoạn C, D, E cho quy trình sản xuất


## Phase 31: Dashboard UI Overhaul & Data Setup (Completed)
- [x] Cải tiến UI machine card theo mẫu ảnh (ảnh máy lớn, metrics overlay)
- [x] Thêm biểu đồ timeline FPY/FY/NTFY/Total (24 giờ qua)
- [x] Tối ưu hiển thị các biểu đồ trên màn hình (giảm chiều cao, responsive)
- [x] Gán sản phẩm cho dây chuyền (4 assignments)
- [x] Tạo lệnh sản xuất cho các dây chuyền (4 orders: PO-2026-001 đến PO-2026-004)
- [x] Thêm máy vào layout SMT (2 máy)
- [x] Thêm máy vào layout Testing (4 máy)
- [x] Tạo công đoạn C, D, E cho các dây chuyền (6 công đoạn mới)


## Phase 32: Machine Status, Metrics Customization, Alerts & Shift Config
- [ ] Thêm trạng thái hoạt động máy (chạy/dừng/lỗi) vào schema
- [ ] Hiển thị trạng thái máy trên layout với màu sắc (xanh=chạy, vàng=dừng, đỏ=lỗi)
- [ ] Tùy chỉnh chỉ số hiển thị trên thẻ máy Dashboard (chọn FPY/FY/NTFY/Output)
- [ ] Lưu cấu hình tùy chỉnh metrics theo user
- [ ] Cảnh báo ngưỡng FPY/FY/NTFY xuống dưới ngưỡng
- [ ] Cải tiến UI upload ảnh máy trong Settings
- [ ] Generate thêm dữ liệu inspection mẫu
- [ ] Thêm Settings > Shift để cấu hình ca làm việc


## Phase 32: Machine Status, Metrics Customization, Alerts & Data (COMPLETED)
- [x] Thêm trạng thái hoạt động máy (chạy/dừng/lỗi) trên layout với indicator màu
- [x] Tùy chỉnh chỉ số hiển thị trên thẻ máy Dashboard (FPY/FY/NTFY/Output toggle)
- [x] Cảnh báo ngưỡng FPY/FY/NTFY trong Settings > Cảnh báo
- [x] UI upload ảnh máy đã có sẵn trong Settings > Máy
- [x] Generate dữ liệu inspection mẫu (300 records cho 6 máy)
- [x] Cấu hình ca làm việc (sáng 6-14h, chiều 14-22h, đêm 22-6h)


## Bug Fixes - Phase 33
- [x] Fix SQL query error: getHourlyStats GROUP BY với DATE_FORMAT không tương thích TiDB (sử dụng raw SQL với alias)
- [x] Fix SQL query error: getDailyStats GROUP BY với DATE_FORMAT không tương thích TiDB (sử dụng raw SQL với alias)


## Phase 34: Layout Image Fix, Auto Sample Image, Machine Mapping & Seed Data
- [ ] Sửa hiển thị ảnh 2D/3D trên Layout Dashboard
- [ ] Tự động lấy ảnh mẫu khi thêm điểm đo với cài đặt vùng cắt (tâm + kích thước)
- [ ] Machine Mapping qua WebSocket - đăng ký máy tự động từ IP/Port
- [ ] API kiểm tra sự tồn tại và cho phép đăng ký máy mới
- [ ] Seed dữ liệu inspection cho 5 ngày


## Phase 34: Layout Image Fix, Measurement Point Crop, Machine Mapping & Data
- [x] Sửa hiển thị ảnh 2D/3D trên Layout Dashboard (cập nhật đường dẫn ảnh)
- [x] Thêm cài đặt cropWidth/cropHeight cho điểm đo
- [x] Tự động lấy ảnh mẫu khi thêm điểm đo theo tâm và kích thước cắt
- [x] Machine Mapping qua WebSocket - đăng ký máy tự động
- [x] API cho máy gửi thông tin và đăng ký qua IP/port
- [x] Seed dữ liệu inspection cho 5 ngày (3000 records)


## Phase 35: Machine Mapping UI, Canvas Crop & WebSocket Test
- [ ] Tạo UI quản lý Machine Mapping trong Settings
- [ ] Hiển thị danh sách máy đang chờ đăng ký
- [ ] Approve/Reject máy đăng ký
- [ ] Monitor trạng thái kết nối realtime
- [ ] Tích hợp canvas crop ảnh mẫu cho điểm đo
- [ ] Tự động crop theo cropWidth/cropHeight khi click điểm đo
- [ ] Lưu ảnh crop làm reference image
- [ ] Viết script Python test WebSocket
- [ ] Mô phỏng máy AVI/AOI gửi đăng ký
- [ ] Gửi heartbeat định kỳ


## Phase 35: Machine Mapping UI, Canvas Crop & WebSocket Test (Completed)
- [x] Tạo UI quản lý Machine Mapping trong Settings (tab Mapping)
- [x] Hiển thị máy chờ đăng ký, approve/reject qua WebSocket
- [x] Monitor trạng thái kết nối realtime
- [x] Tích hợp canvas crop ảnh mẫu cho điểm đo
- [x] Hiển thị vùng crop (rectangle dashed) trên canvas khi chọn điểm
- [x] Viết script Python test WebSocket (scripts/test_machine_websocket.py)
- [x] Mô phỏng đăng ký máy và heartbeat qua WebSocket


## Phase 36: Machine Mapping Test, Auto Crop S3, Realtime Status
- [x] Test Machine Mapping thực tế với script Python
- [x] Tự động crop và lưu ảnh mẫu lên S3 khi save điểm đo
- [x] Dashboard Machine Status realtime với WebSocket heartbeat
- [x] Hiển thị indicator online/offline cho từng máy (UI đã có, WebSocket qua proxy cần polling)

## Known Issues
- [ ] WebSocket qua proxy domain không ổn định (cần sử dụng polling transport)
- [ ] Khi deploy production, WebSocket sẽ hoạt động tốt hơn qua domain chính


## Phase 37: Machine Status Monitor, Offline Notification, Bulk Import
- [x] Trang Machine Status Monitor với lịch sử heartbeat (/machine-status)
- [x] Notification khi máy offline quá 5 phút (offlineMonitor.ts)
- [x] Bulk import measurement points từ Excel (BulkImportDialog.tsx)
- [x] Unit tests cho machine status và bulk import (machineStatus.test.ts)
- [x] Database tables: machine_status_logs, machine_heartbeats
- [x] API endpoints: machineStatus.listWithStatus, machineStatus.getLogs, machineStatus.getHeartbeats, machineStatus.getUptimeStats
- [x] API endpoints: bulkImport.measurementPoints


## Phase 38: Uptime Timeline, Export Report, Alert Configuration
- [x] Biểu đồ uptime timeline cho từng máy (24h/48h/72h/7 ngày)
- [x] Export báo cáo trạng thái máy (JSON/CSV với MTBF/MTTR)
- [x] Cấu hình ngưỡng cảnh báo offline (1-60 phút, bật/tắt)
- [x] Unit tests cho uptime timeline và alert config (uptimeTimeline.test.ts)
- [x] UptimeTimeline component với tooltip và legend
- [x] API endpoints: getUptimeTimeline, getAllUptimeTimelines, getAlertConfig, updateAlertConfig, getReport


## Phase 39: Dashboard Machine Status Widget
- [x] Thêm widget hiển thị số máy online/offline trên Dashboard chính
- [x] Realtime update với WebSocket (sử dụng onlineMachines state)
- [x] Link đến trang Machine Status Monitor
- [x] Hiển thị danh sách máy đang online với badges


## Phase 40: Dashboard Tabs, Measurement Point UX, Layout & Tập đoàn Improvements
- [x] Tách Dashboard thành 2 tabs: Tổng quan và Layout dây chuyền
- [x] Giữ cố định phần lọc và trạng thái kết nối máy
- [x] Thêm hiệu ứng loading khi lưu điểm đo (isSaving state)
- [x] Thêm chọn Upload ảnh hoặc Auto-crop (chỉ 1 chức năng)
- [x] Module Layout: Chỉ hiển thị layout với ảnh 2D/3D, bỏ thông tin trạng thái
- [x] Module Tập đoàn: Thêm drag & drop để thay đổi vị trí trong sơ đồ
- [x] Sửa lỗi mất menu trái (thêm navItems cho MachineStatusMonitor, ProductionOrders)


## Phase 41: Factory Position Persist, Fullscreen Layout, Machine Status Filter
- [ ] Lưu vị trí nhà máy vào database (persist drag & drop positions)
- [ ] Thêm chế độ xem fullscreen cho Layout
- [ ] Thêm filter trạng thái máy trong Layout tab (Online/Offline/All)


## Phase 41: Factory Position Persist, Fullscreen Layout, Machine Status Filter
- [x] Lưu vị trí nhà máy vào database (mapPositionX, mapPositionY columns)
- [x] Tự động load vị trí từ database khi mở CorporateLayout
- [x] Lưu vị trí khi kết thúc drag & drop
- [x] Chế độ xem fullscreen cho Layout page
- [x] Filter trạng thái máy trong Dashboard Layout tab (Online/Offline/All)


## Phase 42: Drag Animation, Machine Position Persist, Mini-map
- [x] Animation smooth khi drag & drop nhà máy trên bản đồ (easing, cleanup)
- [x] Lưu vị trí máy trong Layout page vào database (layoutPositionX, layoutPositionY)
- [x] Cho phép drag & drop máy trong Layout và persist vị trí
- [x] Mini-map góc màn hình khi ở chế độ fullscreen (viewport indicator)


## Phase 43: Mini-map Navigate, Undo/Redo, Snap-to-grid
- [x] Click mini-map để di chuyển viewport đến vị trí tương ứng
- [x] Undo/Redo cho Layout khi sắp xếp lại vị trí máy (nút Undo2/Redo2 trên toolbar)
- [x] Snap-to-grid tự động căn chỉnh máy vào lưới 50px khi kéo thả (nút Grid3X3 toggle)


## Phase 44: Consolidate Upload, Report Export, Manual Mapping
- [x] Bỏ input upload trong 'Ảnh mẫu điểm đo', giữ chọn Upload/Auto-crop ở dưới (UI đã đúng)
- [x] Module Báo cáo: Export PDF, Excel, CSV cho tất cả tabs và biểu đồ
- [x] Mapping Manual trong Settings: CRUD mapping máy qua IP:Port socket


## Phase 45: Manual Mapping Integration, API Docs, History Module Enhancement
- [x] Tích hợp Manual Mapping với socket server thực (test connection thực tế)
- [x] Cập nhật API Docs với cấu trúc định nghĩa đăng ký kết nối đến máy chủ Mapping
- [x] Module Lịch Sử: Thêm bộ lọc theo mã sản phẩm
- [x] Module Lịch Sử: Thêm heatmap chart trong tab SPC
- [x] Tạo seed data 5 ngày x 100 records cho database (500 records)
- [x] Thêm tab thống kê FPY/FY/NTFY/UPH với giao diện theo ảnh mẫu


## Phase 46: UI Improvements và Alert Configuration

- [x] Chỉnh vị trí tab Yield Stats giữa "Danh sách" và "Phân tích"
- [x] Export Yield Report - Thêm xuất PDF/Excel trong tab Yield Stats
- [x] Alert Threshold Configuration - Cấu hình ngưỡng cảnh báo FPY/FY/NTF trong Settings
- [x] Sửa lỗi AI Analysis trong Module Lịch Sử (populate daily_statistics)


## Phase 47: Seed Data, Realtime Alert, Historical Tracking

- [x] Tạo seed data measurement_results tương ứng với product_inspections (16,501 records)
- [x] Realtime Alert Dashboard - Hiển thị cảnh báo Yield realtime trên Dashboard
- [x] Historical Threshold Tracking - Lưu lịch sử thay đổi ngưỡng và so sánh hiệu quả


## Phase 48: Manual Mapping CRUD, Local Auth, User Management

- [x] Manual Mapping: Thêm chức năng Edit kết nối thủ công (đã có sẵn)
- [x] Manual Mapping: Thêm chức năng Delete kết nối thủ công (đã có sẵn)
- [x] Đăng nhập Username/Password: Thêm local authentication
- [x] CRUD trang Người dùng: Tạo/Xem/Sửa/Xóa người dùng


## Phase 49: Admin Default, Change Password, Audit Log
- [x] Tạo tài khoản admin mặc định (username: admin, password: admin123)
- [x] Thêm chức năng đổi mật khẩu cá nhân trong profile/settings
- [ ] Tạo bảng audit_logs để lưu lịch sử hoạt động
- [ ] Ghi log đăng nhập thành công/thất bại
- [ ] Ghi log các thao tác CRUD quan trọng (user, machine, product)
- [ ] Tạo UI xem audit log trong Settings (chỉ admin)


## Phase 50: Two-Factor Authentication (2FA)
- [x] 2FA: Cài đặt thư viện otplib và qrcode
- [x] 2FA: Thêm cột twoFactorSecret và twoFactorEnabled vào bảng users
- [x] 2FA: Tạo API setup2FA (generate secret và QR code)
- [x] 2FA: Tạo API verify2FA và disable2FA
- [ ] 2FA: Cập nhật trang Profile với giao diện bật/tắt 2FA
- [ ] 2FA: Thêm bước xác thực OTP khi đăng nhập nếu đã bật 2FA


## Phase 51: 2FA Settings, Backup Codes, Session Management

- [x] Cài đặt bật/tắt yêu cầu 2FA bắt buộc trong Settings
- [x] Backup Codes: Tạo bảng lưu trữ recovery codes
- [x] Backup Codes: API generate, verify, regenerate codes
- [ ] Backup Codes: UI hiển thị và tải xuống backup codes
- [x] Session Management: Tạo bảng user_sessions
- [ ] Session Management: API list, revoke sessions
- [ ] Session Management: UI quản lý phiên đăng nhập


## Phase 52: Yield Widget Optimization & Workstation Analysis
- [x] Tối ưu Yield Alert Widget trên Dashboard thành dạng compact
- [ ] Thêm trường "Công trạm thực hiện" vào bảng measurement_point_defs
- [ ] Cập nhật UI tạo/sửa điểm đo với dropdown chọn công trạm
- [ ] Tạo bảng workstations để quản lý danh sách công trạm
- [ ] Thêm tab "Phân tích công trạm" trong Module Lịch sử
- [ ] Hiển thị thống kê lỗi theo điểm đo và công trạm thực hiện
- [ ] Biểu đồ phân bố lỗi theo công trạm để đưa ra phương hướng cải thiện


## Phase 53: Workstation Data & Analytics
- [x] Tạo seed data cho bảng workstations (SMT, DIP, Assembly, Testing, Packaging)
- [x] Cập nhật measurementPointDefs với workstationId từ seed data
- [x] Kết nối tab "Công trạm" với API getDefectsByWorkstation
- [x] Hiển thị biểu đồ lỗi theo công trạm trên tab Công trạm
- [x] Thêm widget top 5 công trạm có lỗi cao nhất trên Dashboard
- [x] Hiển thị yield rate theo công trạm

## Phase 54: Workstation Analytics Enhancement
- [x] Thêm filter theo thời gian (Hôm nay, Tuần này, Tháng này, Custom) trong tab Công trạm
- [x] Cập nhật API defectsByWorkstation để hỗ trợ filter thời gian
- [x] Thêm chi tiết điểm đo (measurement points) cho mỗi công trạm
- [x] Hiển thị danh sách top 10 measurement points có lỗi cao nhất
- [x] Thêm chức năng xuất báo cáo công trạm sang PDF
- [x] Thêm chức năng xuất báo cáo công trạm sang Excel
- [x] Báo cáo bao gồm: biểu đồ, thống kê, danh sách lỗi theo điểm đo


## Phase 55: Code Quality & Performance Optimization
- [x] Rà soát chức năng gắn điểm đo với công trạm khi thêm/sửa điểm đo
- [x] Sửa các lỗi SQL liên quan đến LEFT JOIN + COUNT(DISTINCT)
- [x] Thêm query validation layer - helper function kiểm tra GROUP BY completeness
- [x] Tối ưu LEFT JOIN logic - dùng INNER JOIN + UNION ALL thay vì LEFT JOIN
- [x] Thêm query performance monitoring - log query execution time
- [x] Thêm slow query detection để optimize index strategy


## Phase 56: Query Validation Integration & Admin Monitoring
- [x] Tích hợp query validation vào tRPC procedures - tự động validate trước khi execute
- [x] Thêm admin dashboard cho query monitoring - hiển thị slow queries, patterns, stats
- [x] Tối ưu database indexes dựa trên query monitor data
- [x] Tạo migration script để thêm composite indexes


## Phase 57: Product Management Module Review & Enhancement
- [x] Kiểm tra schema productModels và measurementPointDefs
- [x] Rà soát API endpoints cho product model CRUD
- [x] Rà soát UI product management page
- [x] Sửa các lỗi và hoàn thiện chức năng
- [x] Thêm workstationId vào measurement point create/update
- [x] Thêm các trường category, productLine, variant, lifecycleStatus, targetYieldRate, minYieldRate vào edit product dialog
- [x] Thêm workstation dropdown vào measurement point form


## Phase 58: Bulk Import, Templates & Product Comparison
- [x] Thêm bulk import measurement points - upload Excel file (BulkImportDialog component)
- [x] Tạo Excel template cho bulk import (component sẵn có)
- [x] Validate dữ liệu từ Excel trước khi import (component sẵn có)
- [x] Thêm measurement point templates - tạo template cho các loại sản phẩm
- [x] Tạo API để lưu/load measurement point templates (templateRouter)
- [x] Thêm UI để quản lý templates (templateDb.ts)
- [x] Thêm product comparison view - so sánh 2 sản phẩm (ProductComparison page)
- [x] Hiển thị điểm đo khác nhau giữa 2 sản phẩm (comparison logic)
- [x] Suggest điểm đo cần bổ sung (visual car## Phase 59: Workstation Status Indicator & Measurement Point Management
- [x] Thêm workstation status indicator - hiển thị active/inactive badge
- [x] Thêm measurement point search/filter - tìm kiếm theo code, name, type
- [x] Thêm quick actions toolbar - duplicate, export, delete measurement points
- [ ] Kiểm tra, chạy tests và lưu checkpoint


## Phase 60: Measurement Point Templates UI, Batch Operations & Validation
- [x] Thêm measurement point templates UI - save/load/apply templates
- [x] Tạo dialog quản lý templates (list, create, edit, delete)
- [x] Thêm nút "Lưu thành template" trong ProductModels page
- [x] Thêm nút "Áp dụng template" để load template vào sản phẩm
- [x] Thêm batch measurement point operations - bulk select, delete, update, export
- [x] Thêm checkbox multi-select cho measurement points
- [x] Thêm bulk delete với confirmation dialog
- [x] Thêm bulk export selected points to CSV/Excel
- [x] Thêm measurement point validation rules
- [x] Validate duplicate code trong cùng sản phẩm
- [x] Validate giới hạn dưới < giới hạn trên
- [x] Validate required fields (code, name, type)
- [x] Hiển thị validation errors inline


## Phase 61: Empty State UI, Data Seeding Script & Error Boundary

### Empty State UI
- [x] Tạo EmptyState component với icon, title, description và optional action button
- [x] Tích hợp EmptyState vào tab Công trạm trong History khi không có dữ liệu
- [x] Tích hợp EmptyState vào Dashboard widgets khi không có dữ liệu
- [x] Tích hợp EmptyState vào ProductModels page khi không có measurement points

### Data Seeding Script
- [x] Tạo script seed workstations với dữ liệu mẫu
- [x] Tạo script seed measurement_results với dữ liệu mẫu cho analytics
- [ ] Thêm nút "Seed Sample Data" trong Settings page
- [ ] Viết unit tests cho seeding functions### Error Boundary
- [x] Tạo ErrorBoundary component với fallback UI (các variants: default, compact, inline, fullscreen)
- [x] Wrap các component analytics (charts, tables) trong ErrorBoundary
- [ ] Test error boundary bằng cách throw error trong componentog errors để debug



## Phase 62: Loading Skeleton & Error Boundary Integration

### Loading Skeleton cho Analytics Widgets
- [x] Tạo AnalyticsSkeleton component với các variants cho cards, charts, tables
- [x] Tích hợp skeleton vào Dashboard widgets khi đang tải dữ liệu
- [x] Tích hợp skeleton vào History page khi đang tải dữ liệu

### Error Boundary Integration
- [x] Tích hợp Error Boundary vào ProductModels page (canvas, forms, lists)
- [x] Tích hợp Error Boundary vào Settings page (các tabs và forms)
- [x] Test error boundary hoạt động đúng trên các trang mới (TypeScript check passed, 139 tests passed)


## Phase 63: Bug Fixes - ProductModels Page

### Bugs
- [x] Lỗi query measurement_point_templates - đã tạo bảng trong database
- [x] Lỗi Select.Item với value rỗng - đã sửa thành value="all" và cập nhật logic filter


## Phase 64: SelectItem Value Fix & Form Validation

### SelectItem Value Fix
- [x] Tìm tất cả SelectItem với value="" trong toàn bộ project (7 matches trong 2 files)
- [x] Sửa thành value có giá trị hợp lệ ("all", "none")
- [x] Cập nhật logic filter/state tương ứng trong AuditLogs.tsx và Settings.tsx

### Form Validation
- [x] Tạo useFormValidation hook với các validation rules (required, minLength, maxLength, pattern, custom)
- [x] Tạo ValidationMessage component để hiển thị lỗi
- [x] Thêm validation cho form tạo sản phẩm (ProductModels) - code, name
- [x] Thêm validation cho form tạo điểm đo (ProductModels) - code, name, lowerLimit, upperLimit
- [ ] Thêm validation cho các form trong Settings page (tùy chọn - có thể thêm sau)


## Phase 65: Settings Validation & Confirm Dialog

### Settings Form Validation
- [x] Thêm validation cho form tạo ca làm việc (code, name)
- [x] Thêm validation cho form tạo công đoạn (lineId, code, name)
- [x] Thêm validation cho form tạo cảnh báo (name, threshold)

### Confirm Dialog
- [x] Tạo ConfirmDialog component tái sử dụng được (với DeleteConfirmDialog và useConfirmDialog hook)
- [x] Tích hợp confirm dialog vào xóa sản phẩm trong ProductModels
- [x] Tích hợp confirm dialog vào xóa điểm đo trong ProductModels
- [ ] Tích hợp confirm dialog vào các hành động xóa khác trong Settings


## Phase 66: Settings Confirm Dialog, Keyboard Shortcuts & Undo

### Confirm Dialog trong Settings
- [x] Thêm confirm dialog vào xóa ca làm việc
- [x] Thêm confirm dialog vào xóa công đoạn
- [x] Thêm confirm dialog vào xóa cảnh báo
- [x] Thêm confirm dialog vào xóa máy

### Keyboard Shortcuts
- [x] Tạo useKeyboardShortcuts hook với useFormShortcuts và useDialogShortcuts
- [x] Tích hợp Ctrl+S để lưu form trong ProductModels
- [x] Tích hợp Esc để hủy/đóng dialog

### Undo Functionality
- [x] Tạo useUndoDelete hook với toast notification (useUndoDelete và useSimpleUndoDelete)
- [ ] Tích hợp undo vào xóa sản phẩm (tùy chọn - có thể thêm sau)
- [ ] Tích hợp undo vào xóa điểm đo (tùy chọn - có thể thêm sau)
- [ ] Tích hợp undo vào các hành động xóa trong Settings (tùy chọn - có thể thêm sau)


## Phase 67: Menu Optimization, Layout Completion & NG Visual Reflect

### Menu Optimization
- [x] Phân tích cấu trúc menu hiện tại và xác định các category (Tổng quan, Sản xuất, Quản lý, Hệ thống)
- [x] Nhóm các chức năng theo category với NavGroup interface
- [x] Thêm collapsible groups cho menu trái với Collapsible component
- [x] Tối ưu hiển thị menu với icons và labels rõ ràng
- [x] Thêm visual indicator cho menu item đang active và group chứa item active

### Layout Page Completion
- [x] Kiểm tra các chức năng hiện có trong /layout - đã có đầy đủ chức năng
- [x] Factory layout visualization - đã có với 2D/3D view
- [x] Drag-and-drop cho workstation positioning - đã có trong WorkshopLayoutEditor
- [x] Zoom và pan controls - đã có với handleZoomIn/Out, handleMouseDown/Move/Up
- [x] Thêm export layout as image - đã thêm handleExportImage function và Download button

### NG Visual Reflect
- [x] Tạo component hiển thị tỉ lệ NG theo vị trí công trạm (WorkstationNGHeatmap)
- [x] Tạo component hiển thị tỉ lệ NG theo điểm đo (MeasurementPointNGList)
- [x] Thêm color coding (≤2% tốt, 2-5% chấp nhận, 5-10% cảnh báo, >10% nghiêm trọng)
- [x] Tích hợp vào Dashboard với tab "NG Visual" riêng
- [x] Thêm tooltip hiển thị chi tiết khi hover (tổng kiểm tra, số lỗi, tỉ lệ NG)


## Phase 68: NG Visual Enhancements

### Time Filter for NG Visual
- [x] Thêm filter theo thời gian (ngày/tuần/tháng) cho tab NG Visual với Select dropdown
- [x] Sử dụng ngDateRange riêng biệt cho NG Visual tab
- [ ] Hiển thị xu hướng lỗi theo thời gian với biểu đồ trend (tùy chọn)

### Drill-down từ WorkstationNGHeatmap
- [x] Click vào workstation trong heatmap để xem chi tiết các điểm đo
- [x] Hiển thị dialog với danh sách điểm đo của công trạm được chọn
- [x] Hiển thị thống kê chi tiết (tổng, OK, NG, NTF, tỉ lệ NG, giới hạn, avg) cho từng điểm đo

### Export PDF cho NG Visual
- [x] Tạo nút Export PDF trong tab NG Visual
- [x] Tạo báo cáo HTML với WorkstationNGHeatmap và MeasurementPointNGList (có thể in thành PDF)
- [x] Thêm header với thông tin thời gian và tên nhà máy
- [x] Thêm footer với ngày xuất báo cáo


## Phase 68: NG Visual Enhancements

### Time Filter for NG Visual
- [x] Thêm filter theo thời gian (ngày/tuần/tháng) cho tab NG Visual với Select dropdown
- [x] Sử dụng ngDateRange riêng biệt cho NG Visual tab
- [ ] Hiển thị xu hướng lỗi theo thời gian với biểu đồ trend (tùy chọn)

### Drill-down từ WorkstationNGHeatmap
- [x] Click vào workstation trong heatmap để xem chi tiết các điểm đo
- [x] Hiển thị dialog với danh sách điểm đo của công trạm được chọn
- [x] Hiển thị thống kê chi tiết (tổng, OK, NG, NTF, tỉ lệ NG, giới hạn, avg) cho từng điểm đo

### Export PDF cho NG Visual
- [x] Tạo nút Export PDF trong tab NG Visual
- [x] Tạo báo cáo HTML với WorkstationNGHeatmap và MeasurementPointNGList (có thể in thành PDF)
- [x] Thêm header với thông tin thời gian và tên nhà máy
- [x] Thêm footer với ngày xuất báo cáo


## Phase 69: NG Visual Advanced Analytics

### Biểu đồ Trend NG theo thời gian
- [x] Tạo API endpoint getNGTrendByDay để lấy dữ liệu NG trend theo ngày
- [x] Tạo LineChart component hiển thị trend NG theo thời gian với Recharts
- [x] Tích hợp vào tab NG Visual - hiển thị cùng heatmap
- [ ] Thêm filter theo workstation hoặc điểm đo cụ thể (tùy chọn)

### So sánh tỉ lệ NG giữa các khoảng thời gian
- [x] Tạo API endpoint getNGComparison để so sánh NG giữa 2 khoảng thời gian
- [x] Hiển thị 3 comparison cards (kỳ hiện tại, kỳ trước, so sánh)
- [x] Thêm visual indicator (TrendingUp/TrendingDown, màu xanh/đỏ)
- [x] So sánh hôm nay vs hôm qua, tuần này vs tuần trước, tháng này vs tháng trước

### Email Scheduling cho báo cáo NG Visual
- [x] Tạo schema cho scheduled_reports và scheduled_report_logs trong database
- [x] Tạo API endpoint để quản lý scheduled reports (list, getById, create, update, delete, getLogs)
- [ ] Tạo UI trong Settings để cấu hình email scheduling
- [ ] Tích hợp với notification system để gửi email tự động (cần cron job hoặc scheduler)


## Phase 70: Admin Setup, Email Scheduling UI, Cron Job, Trend Filter

### Admin Setup cho lần deploy đầu tiên
- [x] Tạo trang /setup để cài đặt user admin đầu tiên
- [x] Kiểm tra xem đã có admin trong database chưa, nếu chưa redirect đến /setup
- [x] Form nhập thông tin admin (email, name, password)
- [x] Tự động tạo user admin và redirect đến login
- [x] Bảo vệ route /setup - chỉ accessible khi chưa có admin
- [x] Tạo API endpoint auth.setupAdmin với validation
- [x] Tạo database helper getUsersByRole và createUser
- [x] Viết unit tests cho setupAdmin endpoint (6 tests passed)
### Email Scheduling UI trong Settings
- [ ] Tạo tab "Scheduled Reports" trong Settings page
- [ ] Hiển thị danh sách scheduled reports với bảng (name, report type, schedule, recipients, status)
- [ ] Form tạo scheduled report mới (name, report type, schedule, recipients)
- [ ] Form sửa scheduled report
- [ ] Nút xóa scheduled report với confirm dialog
- [ ] Hiển thị logs của scheduled reports

### Cron Job/Scheduler để gửi email tự động
- [ ] Tạo background job/scheduler để check scheduled reports
- [ ] Implement logic gửi email báo cáo NG Visual
- [ ] Lưu log mỗi lần gửi email (success/failure)
- [ ] Xử lý lỗi và retry logic khi gửi email thất bại

### Filter trong biểu đồ Trend
- [ ] Thêm dropdown filter workstation trong NG Trend Chart
- [ ] Thêm dropdown filter điểm đo trong NG Trend Chart
- [ ] Cập nhật query getNGTrendByDay để hỗ trợ filter theo workstation/measurement point
- [ ] Hiển thị trend của workstation/điểm đo được chọn

## Phase 71: Trend Chart Filters trong NG Visual

### Backend API Enhancement
- [x] Cập nhật getNGTrendByDay API để hỗ trợ optional workstationId filter
- [x] Cập nhật getNGTrendByDay API để hỗ trợ optional measurementPointDefId filter
- [x] Thêm validation cho filter parameters
- [x] Test API với các filter combinations (8 unit tests passed)

### Frontend UI
- [x] Thêm workstation dropdown filter trong NG Visual tab
- [x] Thêm measurement point dropdown filter trong NG Visual tab (chỉ hiển thị khi workstation được chọn)
- [x] Kết nối filters với API query
- [x] Hiển thị loading state khi filter thay đổi
- [x] Thêm "Đã lọc" badge khi filters đang active
- [x] Cập nhật chart title để hiển thị filter đang áp dụng
- [x] Test UI với filters trên browser - dropdown hiển thị danh sách workstations

### Unit Tests
- [x] Viết tests cho getNGTrendByDay với workstationId filter
- [x] Viết tests cho getNGTrendByDay với measurementPointDefId filter
- [x] Viết tests cho getNGTrendByDay với cả 2 filters kết hợp
- [x] Viết tests cho getNGTrendByDay với date range filters
- [x] Viết tests cho non-existent workstation/measurement point
- [x] Tất cả 8 unit tests passed
- [ ] Viết tests cho getNGTrendByDay với cả hai filters
- [ ] Verify data accuracy với filters

## Bug Fix: Product Model Update Error

- [x] Kiểm tra database schema product_models table
- [x] Kiểm tra updateProductModel function trong server/db.ts
- [x] Fix SQL update query - duplicate key error khi update code không thay đổi
- [x] Thêm logic kiểm tra code trùng lặp và loại bỏ code khỏi update data nếu không thay đổi
- [x] Test update product model trên UI - thành công
- [x] Verify fix hoạt động đúng

## Bug Fix: AuditLogs Hooks Order Error

- [x] Kiểm tra AuditLogs.tsx để tìm conditional hooks
- [x] Xác định hooks nào đang được gọi conditionally - early return trước hooks
- [x] Sửa hooks order - move tất cả hooks lên trước early return
- [x] Thêm `enabled` option cho queries để chỉ fetch khi user là admin
- [x] Move early return xuống sau tất cả hooks
- [x] Test AuditLogs page trên browser - thành công, không còn lỗi
- [x] Verify fix hoạt động đúng

## Settings Page Tablist Optimization

- [x] Kiểm tra Settings.tsx để xem tất cả tabs hiện tại (11 tabs ngang)
- [x] Phân loại tabs theo category: Cơ sở hạ tầng (5), Sản xuất (3), Chất lượng (2), Hệ thống (1)
- [x] Thiết kế grouped navigation với category headers và collapsible sections
- [x] Implement vertical sidebar navigation (256px width) với 4 categories
- [x] Thêm icons cho mỗi category (Factory, Cog, Award, SettingsIcon) với color coding
- [x] Thêm ChevronDown/ChevronRight icons cho collapse/expand
- [x] Test UX trên browser - collapse/expand và navigation hoạt động tốt
- [x] Verify tất cả settings vẫn accessible - tất cả 11 tabs đều truy cập được

## Products Page Search & Advanced Features

### Search Functionality
- [ ] Thêm search bar ở đầu Products page
- [ ] Backend API hỗ trợ search theo code, name, description
- [ ] Debounce search input để tránh quá nhiều API calls
- [ ] Highlight search keywords trong kết quả

### Advanced Filters
- [ ] Filter theo lifecycle status (active, discontinued, development)
- [ ] Filter theo product category/type
- [ ] Filter theo date range (createdAt, updatedAt)
- [ ] Multi-select filters với clear all button

### Sorting
- [ ] Sort theo code (A-Z, Z-A)
- [ ] Sort theo name (A-Z, Z-A)
- [ ] Sort theo createdAt (newest, oldest)
- [ ] Sort theo updatedAt (newest, oldest)

### Pagination
- [ ] Thêm pagination controls (prev, next, page numbers)
- [ ] Configurable page size (10, 25, 50, 100)
- [ ] Show total count và current range

### Bulk Actions
- [ ] Checkbox để select multiple products
- [ ] Bulk delete với confirmation dialog
- [ ] Bulk export to CSV/Excel
- [ ] Select all / Deselect all

### UI Enhancements
- [ ] Loading skeleton khi fetching data
- [ ] Empty state khi không có kết quả
- [ ] Error state với retry button
- [ ] Responsive design cho mobile

### Unit Tests
- [ ] Test search API với các keywords khác nhau
- [ ] Test filters combinations
- [ ] Test sorting logic
- [ ] Test pagination edge cases

## Products Page Search & Advanced Features

### Backend API Enhancement
- [x] Cập nhật productModel.list API để hỗ trợ search parameter (code, name)
- [x] Thêm lifecycleStatus filter parameter
- [x] Thêm sortBy và sortOrder parameters
- [x] Cập nhật getProductModels function trong db.ts với WHERE, ORDER BY
- [x] Test API với search "PCB" - chỉ hiển thị 2 products

### Frontend UI
- [x] Thêm search bar với clear button (X icon)
- [x] Thêm lifecycle status filter dropdown (Tất cả, Phát triển, Đang dùng, EOL, Lưu trữ)
- [x] Thêm sort dropdown (Mới nhất, Cũ nhất, Tên A-Z/Z-A, Mã A-Z/Z-A)
- [x] Hiển thị "Đã lọc" badge khi search hoặc filter active
- [x] Thêm "Xóa bộ lọc" button để reset search và filters
- [x] Test UX với search "PCB" - hoạt động tốt, hiển thị 2 kết quả

## Dashboard Machine 2D Image & Realtime Status

### Database Schema Enhancement
- [x] image2DUrl và image2DKey fields đã có sẵn trong machines table schema
- [x] Tạo default machine 2D SVG image tại /client/public/default-machine-2d.svg
- [x] Không cần migration - schema đã có sẵn

### Dashboard UI Enhancement
- [x] Cập nhật Dashboard.tsx line 2038: machineImage = image2DUrl || image3DUrl || '/default-machine-2d.svg'
- [x] Hiển thị ảnh mặc định SVG cho tất cả machines chưa có custom image
- [x] Online/offline status indicator đã có sẵn (lines 2106-2126): Wifi icon (green) = online, WifiOff icon (gray) = offline
- [x] Machine cards đã có style với gradient background, border, shadow, hover effects

### WebSocket Realtime Status
- [x] Server emit machine:status_change events (socket.ts line 209)
- [x] Dashboard listen machine:online_list event (Dashboard.tsx lines 184-186)
- [x] onlineMachines Set tracks online machine codes realtime
- [x] Server tracks connectedMachines và onlineMachineCodesMap (socket.ts lines 25-27)
- [x] Test: 0 online, 13 offline, 0% availability - hoạt động đúng

### Settings Page Enhancement
- [ ] Thêm upload 2D image field trong Machine CRUD (Settings > Máy móc)
- [ ] Preview ảnh 2D khi upload
- [ ] Validate image format (SVG, PNG, JPG)

## Email Scheduling UI & Cron Job Scheduler

### Database Schema
- [x] scheduled_reports table đã có sẵn trong schema (drizzle/schema.ts lines 882-918)
- [x] scheduled_report_logs table đã có sẵn trong schema (drizzle/schema.ts lines 926-941)
- [x] Tables đã tồn tại trong database

### Backend API
- [x] scheduledReport router đã có sẵn với CRUD procedures (list, create, update, delete, getLogs)
- [x] Database helpers đã có sẵn: getScheduledReports, createScheduledReport, updateScheduledReport, deleteScheduledReport
- [x] Tạo email service với Nodemailer (server/_core/email.ts)
- [x] Tạo report generator (server/services/reportGenerator.ts) - generate NG Visual report data
- [x] Tạo HTML email template cho NG Visual reports
- [x] Thêm scheduler hooks vào create/update/delete procedures

### Settings UI - Scheduled Reports Tab
- [x] Thêm "Báo cáo tự động" tab trong Settings page (Hệ thống category)
- [x] Tạo ScheduledReports component (client/src/components/ScheduledReports.tsx)
- [x] Hiển thị danh sách scheduled reports với status badges
- [x] Thêm "Tạo báo cáo mới" button và dialog
- [x] Dialog form fields: name, description, reportType, schedule (DAILY/WEEKLY/MONTHLY), scheduleTime, dayOfWeek/dayOfMonth, recipients
- [x] Edit dialog để sửa scheduled report
- [x] Delete confirmation dialog
- [x] Toggle active/inactive switch
- [x] Hiển thị lastSentAt và nextScheduledAt
- [x] Empty state khi chưa có reports
- [x] Test UI trên browser - hiển thị đúng

### Cron Job Scheduler
- [x] Install node-cron và nodemailer packages
- [x] Tạo reportScheduler service (server/services/reportScheduler.ts)
- [x] scheduleToCronExpression() function convert schedule config sang cron expression
- [x] scheduleReport() function để schedule/re-schedule reports
- [x] stopScheduledReport() function để stop cron jobs
- [x] initializeScheduledReports() được gọi khi server start (server/_core/index.ts)
- [x] shutdownScheduledReports() được gọi khi server shutdown (SIGTERM/SIGINT)
- [x] executeScheduledReport() function generate report + send email
- [x] Log execution results vào scheduled_report_logs table
- [x] Error handling và logging
- [x] Scheduler hooks trong create/update/delete procedures

### Email Template
- [x] Tạo HTML email template cho NG Visual report (generateNGVisualEmailHTML function)
- [x] Include report summary (totalInspections, totalNG, ngRate, avgNGPerProduct)
- [x] Include top NG points table
- [x] Include trend chart data
- [x] Professional HTML/CSS styling

### Unit Tests
- [ ] Test scheduledReport CRUD APIs
- [ ] Test cron expression conversion
- [ ] Test generateNGVisualReport function
- [ ] Test email sending function
- [ ] Test scheduler initialization

## Phase 73: SMTP Configuration, Test Email & Report Customization

### SMTP Configuration UI
- [x] Tạo smtp_config table (host, port, secure, username, password, fromEmail, fromName)
- [x] Tạo API endpoints: smtp.getConfig, smtp.updateConfig, smtp.testConnection
- [x] Tạo SMTP Configuration tab trong Settings (Hệ thống category)
- [x] Form fields: Host, Port, Secure (SSL/TLS toggle), Username, Password, From Email, From Name
- [x] Test Connection button để verify SMTP config
- [x] Cập nhật email service để sử dụng SMTP config từ database (createTransporterFromConfig)
- [x] Database helpers: getSmtpConfig, updateSmtpConfig
- [x] SMTPConfig component với form và test connection

### Test Email Sending
- [x] Thêm "Gửi thử" (Send icon) button trong scheduled reports list
- [x] Tạo API endpoint scheduledReport.sendTest
- [x] Generate sample report data cho test email (last 7 days)
- [x] Gửi test email với [TEST] prefix trong subject
- [x] Hiển thị success/error toast sau khi gửi
- [x] Log test email sends vào scheduled_report_logs (SUCCESS/FAILED)
- [x] Check SMTP config exists trước khi gửi

### Report Customization (Not Implemented - Optional Enhancement)
- [ ] Thêm reportFormat field vào scheduled_reports table (HTML/PDF/EXCEL)
- [ ] Thêm customization fields: logoUrl, primaryColor, footerText
- [ ] Cập nhật ScheduledReports form để include customization options
- [ ] Color picker cho primaryColor
- [ ] Logo upload với preview
- [ ] Footer text textarea
- [ ] Cập nhật email template generator để sử dụng custom colors/logo
- [ ] Implement PDF generation với puppeteer hoặc html-pdf
- [ ] Implement Excel generation với exceljs

### Unit Tests
- [ ] Test SMTP config CRUD APIs
- [ ] Test SMTP connection validation
- [ ] Test email sending với custom SMTP config
- [ ] Test scheduledReport.sendTest endpoint

## Phase 74: Review & Complete Email Features

### Review Status
- [ ] Review Email Scheduling UI - kiểm tra CRUD hoạt động đúng
- [ ] Review Cron Job Scheduler - kiểm tra scheduler khởi động và chạy đúng
- [ ] Review SMTP Configuration - kiểm tra form và test connection
- [ ] Review Test Email Sending - kiểm tra nút "Gửi thử" hoạt động
- [ ] Test toàn bộ flow: config SMTP → tạo scheduled report → gửi thử → verify email

### Bug Fixes (nếu có)
- [ ] Fix các lỗi phát hiện trong quá trình review

### Report Customization Implementation
- [ ] Thêm reportFormat field vào scheduled_reports table (HTML/PDF/EXCEL)
- [ ] Thêm customization fields: logoUrl, primaryColor, footerText
- [ ] Cập nhật ScheduledReports form để include customization options
- [ ] Color picker cho primaryColor
- [ ] Logo upload với preview
- [ ] Footer text textarea
- [ ] Cập nhật email template generator để sử dụng custom colors/logo
- [ ] Implement PDF generation
- [ ] Implement Excel generation

### Unit Tests
- [ ] Test SMTP config CRUD APIs
- [ ] Test scheduledReport.sendTest endpoint
- [ ] Test report customization rendering

## Phase 75: SMTP Configuration UI Fix

### Bug Fixes
- [x] Fix "Kiểm tra kết nối" button visibility issue in SMTP Configuration
- [x] Update button variant from outline to outline with bg-muted/50 for better visibility
- [x] Update testConnection API to accept form data for testing before saving
- [x] Enable test connection button when host and username are filled (not just when config saved)
- [x] Improve UX: users can test SMTP connection before saving configuration

### Testing
- [x] Verified button displays correctly when form fields are filled
- [x] All 153 unit tests passing
- [x] No regressions detected

## Phase 76: Report Customization Implementation (Jan 22, 2025)

### Database Schema
- [x] Add reportFormat column (ENUM: HTML, PDF, EXCEL) to scheduled_reports table
- [x] Add logoUrl column (VARCHAR 500) for custom logo URL
- [x] Add primaryColor column (VARCHAR 20) for email primary color
- [x] Add footerText column (TEXT) for custom footer text

### Backend API
- [x] Update scheduledReport.create mutation with customization fields
- [x] Update scheduledReport.update mutation with customization fields
- [x] Add scheduledReport.uploadLogo mutation for logo upload to S3

### Frontend UI
- [x] Add Tabs component to ScheduledReports dialog (Cơ bản / Tùy chỉnh)
- [x] Create Report Format selector (HTML/PDF/Excel)
- [x] Create Logo upload with preview and delete button
- [x] Create Color picker with hex input and preview bar
- [x] Create Footer text textarea
- [x] Create Live email preview section showing header/content/footer
- [x] Add reportFormat column to reports table display

### Testing
- [x] All 153 unit tests passing
- [x] UI tested and working correctly

### Unit Tests Added
- [x] Create scheduledReport.test.ts with 15 test cases
- [x] Test scheduled report CRUD operations
- [x] Test SMTP configuration retrieval
- [x] Test report customization fields validation
- [x] Test logo upload filename generation
- [x] Test base64 data extraction
- [x] All 168 unit tests passing

## Phase 77: PDF/Excel Generation & Email Template Customization (Jan 22, 2025)

### Email Template với Customization
- [x] Cập nhật generateNGVisualEmailHTML để sử dụng logoUrl, primaryColor, footerText
- [x] Tạo email template với header động (logo + màu chủ đạo)
- [x] Tạo footer động với custom text
- [x] Hỗ trợ inline CSS cho email compatibility
- [x] Gradient colors tự động tính từ primary color

### PDF Generation
- [x] Install puppeteer cho PDF generation
- [x] Tạo generateNGVisualPDF function
- [x] Include charts và tables trong PDF
- [x] Support custom logo và colors trong PDF

### Excel Generation
- [x] Sử dụng exceljs để generate Excel files
- [x] Tạo generateNGVisualExcel function
- [x] Include data tables với formatting
- [x] Add summary sheet với statistics
- [x] Styled headers và alternating row colors

### Cập nhật Send Email Logic
- [x] Cập nhật sendTest để hỗ trợ PDF/Excel attachments
- [x] Cập nhật cron job để gửi đúng format đã chọn
- [x] Xử lý attachments trong nodemailer

### Preview Email với Dữ liệu Thực
- [x] Tạo API endpoint previewEmail để preview email với data thực
- [x] Thêm nút "Xem trước với dữ liệu thực" trong UI (icon Eye)
- [x] Hiển thị preview trong modal với HTML rendered
- [x] Hiển thị summary statistics (Tổng kiểm tra, Tổng NG, Tỷ lệ NG, Định dạng)
- [x] Fix toFixed bug trong formatPercent function

### Testing
- [x] All 168 unit tests passing
- [x] UI tested and working correctly


## Phase 78: MQTT Integration & Client Management (Jan 22, 2025)

### 1. Database Schema
- [x] Create mqtt_clients table (id, clientId, deviceId, stationId, status, approvalStatus, lastSeen, createdAt)
- [x] Create mqtt_subscriptions table (id, clientId, topic, createdAt)
- [x] Create mqtt_error_summary table for storing aggregated summaries
- [x] Create mqtt_message_logs table for tracking sent messages
- [x] Add mappingType column (AUTO/MANUAL) to mqtt_clients
- [x] Add autoReconnect flag to client registration
- [x] Add notification settings (receiveNGAlerts, receiveDailySummary, receiveWeeklySummary)

### 2. MQTT Server Setup
- [x] Install aedes package for MQTT broker
- [x] Create MQTT broker service with authentication (mqttService.ts)
- [x] Implement client connection/disconnection handlers
- [x] Setup topic structure: avi/factory/{id}/workshop/{id}/station/{id}/errors
- [x] Integrate MQTT with existing Express server (disabled by default, MQTT_ENABLED=true to enable)

### 3. Client Registration & Auto-Mapping
- [x] Create API for client registration via MQTT auth
- [x] Create admin UI for approving/rejecting client registrations
- [x] Implement auto-reconnect logic based on deviceId
- [x] Store client-station mapping in database
- [x] Allow disconnect and re-mapping for auto-connected clients (disconnectAndReset API)
- [x] Update mapping settings (stationId, processId, mappingType)
- [x] Update notification settings per client

### 4. Scheduled Error Summary
- [x] Create daily error summary aggregation job (6:00 AM)
- [x] Create weekly error summary aggregation job (Monday 6:00 AM)
- [x] Store summary data in mqtt_error_summary table
- [x] Publish summary to MQTT topics for relevant stations
- [x] Include measurement point statistics in summary (topNGPoints)

### 5. Unified Mapping Table UI
- [x] Create UnifiedMappingTable component
- [x] Merge MQTT clients and manual connections in same table
- [x] Add tabs filter (All/MQTT/Manual)
- [x] Add search and status filter
- [x] Add approve/reject/edit/delete actions
- [x] Display client status (online/offline/pending approval)
- [x] Add notification settings toggle (NG alerts, daily/weekly summary)

### 6. MQTT Error Message Publishing
- [x] Implement publishNGAlert function in mqttService.ts
- [x] Integrate with inspection router - publish on NG detection
- [x] Include measurement results in MQTT payload
- [x] Implement publishSummary function for daily/weekly summaries
- [x] Log messages to mqtt_message_logs table

### 7. Testing
- [x] All 168 unit tests passing
- [x] TypeScript compilation successful
- [x] UI tested and working correctly


## Phase 79: Mobile App, MQTT Dashboard & Push Notifications (Jan 22, 2025)

###### 1. MQTT Dashboard
- [x] Tạo trang MQTT Dashboard trong web app (/mqtt-dashboard)
- [x] Hiển thị connected clients (online/offline count)
- [x] Hiển thị message statistics (sent/failed/NG alerts)
- [x] Hiển thị delivery status và success rate
- [x] Thêm charts cho message trends (Recharts line chart, pie chart)
- [x] Thêm recent messages table
- [x] Thêm tabs Connected Clients và Recent Messages
- [x] Thêm time range filter (7/14/30 ngày)

### 2. Firebase Cloud Messaging (FCM)
- [x] Tạo fcmService.ts
- [x] Implement sendNGAlertPushNotification
- [x] Implement sendSummaryPushNotification
- [x] Tích hợp FCM vào mqttService khi publish NG alerts
- [x] Tích hợp FCM vào mqttService khi publish summaries
- [x] Thêm fcmToken column vào mqtt_clients table
- [x] Tạo notification payload với NG alert data

### 3. Mobile App Setup (React Native)
- [x] Tạo React Native project với Expo (mobile-app/)
- [x] Setup MQTT client library (mqtt.js)
- [x] Implement connection/reconnection logic (Zustand store)
- [x] Setup Expo Notifications cho push notifications
- [x] Tạo app settings screen (display time, server URL, etc.)

### 4. Mobile App UI
- [x] Tạo NG Alert popup overlay với auto-dismiss (NGAlertPopup.tsx)
- [x] Hiển thị thông tin lỗi (machine, serial, timestamp)
- [x] Hiển thị ảnh vị trí lỗi
- [x] Hiển thị thống kê lỗi theo trạm (HomeScreen.tsx)
- [x] Cài đặt thời gian hiển thị popup (mặc định 60 giây)
- [x] Nút tắt popup thủ công
- [x] Progress bar animation cho auto-dismiss

### 5. Testing
- [x] Test MQTT Dashboard UI - Đã hoạt động
- [x] All 168 unit tests passing
- [x] TypeScript compilation successful


## Phase 80: FCM, Mobile App Build & MQTT Configuration (Jan 22, 2025)

### 1. FCM Configuration (HTTP v1 API)
- [x] Cập nhật fcmService.ts sử dụng FCM HTTP v1 API
- [x] Sử dụng Service Account authentication thay vì Server Key
- [x] Hướng dẫn tạo Firebase project và Service Account
- [x] Thêm FIREBASE_SERVICE_ACCOUNT_JSON vào environment
- [x] Validate Service Account JSON với unit test

### 2. Mobile App Build
- [x] Mobile app source code đã sẵn sàng trong mobile-app/
- [ ] Cài đặt dependencies: cd mobile-app && npm install
- [ ] Chạy Expo development server: npm start
- [ ] Test app trên Expo Go

### 3. MQTT Broker
- [x] Thêm MQTT_ENABLED=true vào environment
- [x] Tích hợp MQTT broker vào server index.ts
- [x] MQTT Server đã Online (port 1883)
- [x] MQTT Summary Scheduler đã khởi động

### 4. Testing
- [x] All 172 unit tests passing
- [x] TypeScript compilation successful
- [x] MQTT Dashboard hiển thị "Online"
- [ ] Test MQTT connection
- [ ] Verify MQTT Dashboard hiển thị đúng


## Phase 81: Mobile App Build & MQTT Testing (Jan 22, 2025)

### 1. Build Mobile App
- [x] Cài đặt dependencies cho mobile-app (npm install)
- [x] Mobile app sẵn sàng chạy với Expo
- [x] Cập nhật README với hướng dẫn kết nối MQTT

### 2. Expose MQTT Port
- [x] Expose port 1883 cho external access
- [x] Public URL: https://1883-idqnmv2bbepy0zwa36z11-7e70e14f.sg1.manus.computer
- [x] Lưu ý: MQTT sử dụng TCP, không phải HTTPS

### 3. Test MQTT Connection
- [x] Kiểm tra MQTT broker đang chạy (port 1883)
- [x] Test publish với mosquitto_pub - Thành công
- [x] Test subscribe với mosquitto_sub - Thành công
- [x] Message được truyền đúng giữa publisher và subscriber


## Phase 82: Mobile App Expo & Cloud MQTT Integration (Jan 22, 2025)

### 1. Chạy Mobile App với Expo
- [x] Mobile app dependencies đã cài đặt
- [x] Source code sẵn sàng trong mobile-app/
- [ ] Chạy trên máy local: cd mobile-app && npm start

### 4. Testing
- [x] All 175 unit tests passing
- [x] TypeScript compilation successful
- [x] MQTT Dashboard hiển thị Local: Online và Cloud: Connected

### 2. Cloud MQTT Broker Integration
- [x] Chọn HiveMQ Public Broker (miễn phí, không cần đăng ký)
- [x] Thêm mqtt package vào server
- [x] Tạo external MQTT client trong mqttService.ts
- [x] Publish đồng thời đến local và external broker
- [x] Thêm external MQTT status vào dashboard
- [x] Cấu hình qua env: EXTERNAL_MQTT_ENABLED, EXTERNAL_MQTT_BROKER, EXTERNAL_MQTT_TOPIC_PREFIX

### 3. Hướng dẫn Test trên thiết bị thật
- [x] Cập nhật README với hướng dẫn HiveMQ Public Broker
- [x] Cập nhật MQTT Topics cho cả local và external broker
- [x] Hướng dẫn cấu hình cho Android Emulator và iOS Simulator


## Phase 83: MQTT Enhancements - Test NG Alert, Authentication & Monitoring (Jan 22, 2025)

### 1. Test NG Alert trên Mobile
- [x] Tạo API endpoint để simulate NG inspection (testNGAlert mutation)
- [x] Thêm Test NG Alert button trên MQTT Dashboard
- [x] Test MQTT publish đến local và external broker
- [x] Verify message được gửi đến HiveMQ

### 2. MQTT Authentication
- [x] Thêm username/password config cho external MQTT (EXTERNAL_MQTT_USERNAME, EXTERNAL_MQTT_PASSWORD)
- [x] Cập nhật mqttService để sử dụng credentials
- [x] Thêm TLS/SSL support (EXTERNAL_MQTT_USE_TLS detection)
- [x] Cập nhật getExternalMqttInfo để trả về thêm thông tin TLS và credentials

### 3. Realtime Monitoring Dashboard
- [x] Thêm realtimeStats endpoint với throughput và latency metrics
- [x] Thêm getMqttMessageCountSince function trong db.ts
- [x] Thêm getMqttLatencyStats function trong db.ts
- [x] Thêm publishToExternalMqtt function trong mqttService.ts
- [x] Thêm Realtime Monitoring section trên MQTT Dashboard
  - Throughput (1 phút) - msg/phút
  - Throughput (5 phút) - avg msg/phút
  - Latency (Avg) - ms với P95
  - External Broker Status - Connected/Connecting/Disabled
- [x] Auto refresh mỗi 10 giây

### 4. Testing
- [x] Tạo unit tests cho MQTT features (mqtt.test.ts)
- [x] All 184 unit tests passing
- [x] TypeScript compilation successful


## Phase 84: MQTT Advanced Features - Credentials, Charts & Alert Rules (Jan 22, 2025)

### 1. HiveMQ Cloud Credentials
- [x] Hướng dẫn cấu hình EXTERNAL_MQTT_USERNAME và EXTERNAL_MQTT_PASSWORD
- [x] Thêm TLS/SSL support cho HiveMQ Cloud (EXTERNAL_MQTT_USE_TLS)
- [x] Cập nhật mqttService để sử dụng mqtts:// protocol

### 2. Biểu đồ Throughput theo thời gian
- [x] Thêm throughputHistory endpoint trong routers.ts
- [x] Thêm getMqttThroughputHistory function trong db.ts
- [x] Thêm Line Chart component hiển thị throughput 1 giờ qua
- [x] Thêm vào MQTT Dashboard (auto refresh mỗi phút)

### 3. Alert Rules cho MQTT
- [x] Tạo bảng mqtt_alert_rules và mqtt_alert_history trong schema.ts
- [x] Thêm CRUD endpoints cho alert rules (mqttAlertRouter)
- [x] Tạo trang MqttAlertRules.tsx với UI quản lý rules
- [x] Thêm vào navigation sidebar
- [ ] Thêm logic kiểm tra latency threshold
- [ ] Thêm logic kiểm tra broker disconnect
- [ ] Gửi notification khi alert triggered
- [ ] Thêm UI quản lý alert rules


## Phase 85: Alert Automation & Dashboard Widget

### 1. Alert Evaluation Engine
- [x] Tạo alertEvaluationService.ts để kiểm tra alert rules
- [x] Thêm background job chạy mỗi phút để evaluate rules
- [x] Implement logic kiểm tra LATENCY_THRESHOLD
- [x] Implement logic kiểm tra BROKER_DISCONNECT
- [x] Implement logic kiểm tra MESSAGE_FAILURE_RATE
- [x] Implement logic kiểm tra THROUGHPUT_LOW/HIGH
- [x] Implement logic kiểm tra CLIENT_OFFLINE
- [x] Thêm cooldown mechanism để tránh spam alerts
- [x] Lưu alert history vào database
- [x] Tích hợp với notifyOwner cho Manus notifications

### 2. Email Notification
- [x] Cấu hình nodemailer với SMTP settings
- [x] Thêm SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ALERT_EMAIL_TO vào env
- [x] Tạo email template cho alerts (HTML responsive)
- [x] Gửi email khi alert được trigger (nếu notifyEmail = true)
- [x] Tích hợp với alertEvaluationService

### 3. Dashboard Alert Widget
- [x] Thêm Alert Widget vào Dashboard.tsx
- [x] Hiển thị số alert chưa xử lý
- [x] Hiển thị 3 alerts gần nhất
- [x] Thêm link đến /mqtt-alerts
- [x] Auto refresh mỗi 30 giây
- [x] Ẩn widget khi không có alert

### 4. Testing
- [x] Viết unit tests cho alertEvaluationService
- [x] Viết unit tests cho alert rule CRUD
- [x] Test alert rule toggle và delete
- [x] 193 unit tests passing


## Phase 86: System Configuration & Alert Enhancements

### 0. MQTT/WebSocket Configuration (Admin Only)
- [x] Tạo bảng system_config trong schema.ts
- [x] Thêm CRUD endpoints cho system config (adminProcedure)
- [x] Tạo trang System Configuration (/system-config)
- [x] Thêm toggle switches cho MQTT_ENABLED và WEBSOCKET_ENABLED
- [x] Hiển thị current status của MQTT và WebSocket
- [x] Thêm vào navigation sidebar
- [ ] Implement server restart functionality (requires backend support)

### 1. Alert Notification History Dashboard
- [ ] Tạo bảng alert_notification_logs trong schema.ts
- [ ] Log tất cả notifications (owner, email, MQTT) vào database
- [ ] Tạo trang Alert Notification History
- [ ] Thêm filters: date range, notification type, status
- [ ] Thêm search by rule name
- [ ] Hiển thị statistics: total sent, success rate, failed count
- [ ] Thêm retry button cho failed notifications

### 2. Alert Rule Templates
- [ ] Tạo predefined templates trong code
- [ ] Thêm "Use Template" button trong Create Alert Rule page
- [ ] Templates: High Latency, Broker Down, High Failure Rate, Low Throughput
- [ ] User có thể customize template trước khi save
- [ ] Thêm "Save as Template" cho existing rules

### 3. Alert Severity Levels
- [ ] Thêm severity column vào mqtt_alert_rules (CRITICAL, WARNING, INFO)
- [ ] Cập nhật UI để hiển thị severity với màu sắc khác nhau
- [ ] Thêm severity filter trong Alert Rules page
- [ ] Cập nhật Dashboard Alert Widget để ưu tiên CRITICAL
- [ ] Thêm severity vào email template
- [ ] Sort alerts by severity trong history

### 4. Testing
- [ ] Viết unit tests cho system config CRUD
- [ ] Viết unit tests cho notification logging
- [ ] Test alert templates
- [ ] Test severity levels


## Phase 87: System Audit & CRUD Completion

### 1. Database Schema Audit
- [ ] Rà soát tất cả các bảng trong schema.ts
- [ ] Liệt kê các bảng chưa có CRUD endpoints
- [ ] Kiểm tra relationships và foreign keys
- [ ] Kiểm tra indexes và performance

### 2. CRUD Completion
- [ ] Bổ sung CRUD cho factories (nếu thiếu)
- [ ] Bổ sung CRUD cho workshops
- [ ] Bổ sung CRUD cho production_lines
- [ ] Bổ sung CRUD cho stations
- [ ] Bổ sung CRUD cho machines
- [ ] Bổ sung CRUD cho processes
- [ ] Bổ sung CRUD cho measurement_point_defs
- [ ] Bổ sung CRUD cho product_models
- [ ] Bổ sung CRUD cho shift_configs
- [ ] Bổ sung CRUD cho production_orders
- [ ] Bổ sung CRUD cho alert_settings
- [ ] Bổ sung CRUD cho system_settings

### 3. API Inspection Enhancement
- [x] Thêm corporateCode vào product_inspections table
- [x] Thêm factoryCode vào product_inspections table
- [x] Thêm indexes cho corporateCode và factoryCode
- [x] Cập nhật submitInspection API để nhận companyCode và factoryCode
- [x] Cập nhật getInspections API để filter theo corporateCode và factoryCode
- [x] Cập nhật schema.ts với corporateCode và factoryCode
- [ ] Cập nhật dashboard statistics để group theo corporate và factory

### 4. Error Checking & Fixes
- [x] Kiểm tra tất cả routers có missing procedures không
- [x] Kiểm tra tất cả db functions có missing exports không
- [x] Kiểm tra TypeScript errors (0 errors)
- [x] Tạo CRUD Coverage Summary document
- [ ] Kiểm tra foreign key constraints
- [ ] Kiểm tra data validation trong input schemas
- [ ] Kiểm tra authorization (admin vs user procedures)

### 5. Testing
- [x] Viết tests cho inspection API với corporate/factory codes
- [x] Test submitInspection với companyCode và factoryCode
- [x] Test backward compatibility (không có corporate/factory codes)
- [x] 2 tests passed


## Phase 88: Enterprise Features

### 1. Dashboard Statistics by Corporate/Factory
- [x] Thêm corporateFactoryStatsRouter trong routers.ts
- [x] Thêm db functions: getYieldRateByCorporate, getYieldRateByFactory
- [x] Thêm db functions: getThroughputByCorporate, getThroughputByFactory
- [x] Tạo CorporateFactoryStats component
- [x] Thêm biểu đồ Bar Chart cho yield rate comparison
- [x] Thêm biểu đồ Line Chart cho throughput trends
- [x] Thêm filters: date range (7d/30d/90d), corporate selector
- [x] Thêm tab "Công ty/Nhà máy" trong Dashboard
- [x] Summary cards cho từng corporate

### 2. Bulk Import/Export
- [ ] Cài đặt xlsx package
- [ ] Tạo importRouter với endpoints: importFactories, importWorkshops, importMachines
- [ ] Tạo exportRouter với endpoints: exportInspections, exportStatistics
- [ ] Thêm validation cho import data
- [ ] Thêm error handling và rollback cho failed imports
- [ ] Tạo Import/Export page trong UI
- [ ] Thêm file upload component
- [ ] Thêm download Excel template buttons
- [ ] Thêm progress indicator cho bulk operations

### 3. Multi-tenant Access Control
- [ ] Thêm user_corporate_assignments table
- [ ] Thêm user_factory_assignments table
- [ ] Thêm middleware checkCorporateAccess
- [ ] Thêm middleware checkFactoryAccess
- [ ] Cập nhật tất cả inspection/statistics endpoints với access control
- [ ] Tạo User Assignment page cho admin
- [ ] Thêm corporate/factory selector trong user profile
- [ ] Filter data theo user assignments trong tất cả list endpoints

### 4. Testing
- [ ] Viết tests cho corporate/factory statistics
- [ ] Viết tests cho import/export functions
- [ ] Viết tests cho multi-tenant access control
- [ ] Run all tests và fix failures


## Phase 89: Enterprise Features Implementation

### 1. Bulk Import/Export
- [x] Thêm importRouter với importFactories, importWorkshops, importMachines endpoints
- [x] Thêm exportRouter với exportInspections, exportStatistics endpoints
- [x] Thêm db helper functions: getFactoryByCode, getWorkshopByCode, getStationByCode, getProductionLineByCode
- [x] Tạo ImportExport.tsx page với file upload UI
- [x] Implement Excel template download (3 templates)
- [x] Implement Excel parsing với xlsx library
- [x] Implement batch insert với error handling và result summary
- [x] Implement export với S3 upload (inspections và statistics)
- [x] Thêm vào navigation (admin only)
- [x] Thêm route /import-export trong App.tsx

### 2. Multi-tenant Access Control
- [x] Thêm userCorporateAssignments và userFactoryAssignments tables
- [x] Thêm db helper functions: getUserCorporateAssignments, getUserFactoryAssignments, createCorporateAssignment, createFactoryAssignment, deleteCorporateAssignment, deleteFactoryAssignment
- [x] Thêm access check functions: hasAccessToCorporate, hasAccessToFactory
- [ ] Tạo userAssignmentRouter với CRUD endpoints
- [ ] Cập nhật tất cả inspection/statistics procedures với access control
- [ ] Tạo UserAssignments.tsx page
- [ ] Implement assignment UI với badges và selectors
- [ ] Test access control trong tất cả endpoints

### 3. Dashboard Drill-down
- [ ] Thêm onClick handler cho corporate bar chart
- [ ] Thêm drill-down state management
- [ ] Implement factory details modal/panel
- [ ] Thêm machine-level analytics query
- [ ] Implement breadcrumb navigation
- [ ] Thêm back button để quay lại corporate view
- [ ] Thêm loading states cho drill-down transitions


## Phase 90: Complete Enterprise Features

### 1. Multi-tenant UI Implementation
- [x] Tạo userAssignmentRouter với getMyAssignments, getAllUserAssignments, assignCorporate, assignFactory, removeCorporateAssignment, removeFactoryAssignment
- [x] Tạo UserAssignments.tsx page với user selector, corporate/factory input
- [x] Implement assignment form với validation
- [x] Implement assignment list với badges và remove buttons
- [x] Thêm route /user-assignments trong App.tsx
- [x] Thêm vào navigation (admin only)
- [x] Thêm getUsers function vào db.ts

### 2. Access Control Application
- [x] Update getProductInspections để filter theo user assignments
- [x] Update inspectionRouter.list để pass userId và userRole
- [x] Thêm logic kiểm tra corporateAssignments và factoryAssignments
- [x] Non-admin users chỉ xem được data của assigned corporates/factories
- [ ] Update corporateFactoryStatsRouter để filter theo assignments
- [ ] Update dashboardRouter.stats để filter theo assignments
- [ ] Test access control với non-admin user
- [ ] Verify admin can see all data

### 3. Dashboard Drill-down
- [ ] Add drill-down state management trong CorporateFactoryStats
- [ ] Add onClick handler cho corporate bar chart
- [ ] Thêm factoryDetails query endpoint
- [ ] Thêm machineAnalytics query endpoint
- [ ] Implement breadcrumb navigation
- [ ] Implement FactoryChart component
- [ ] Implement MachineAnalyticsTable component
- [ ] Add loading states

### 4. Testing
- [x] Run all tests (195 tests passed)
- [x] Test inspection API với corporate/factory codes
- [x] Test backward compatibility
- [ ] Test user assignment CRUD (manual testing required)
- [ ] Test access control filtering với non-admin user (manual testing required)


## Phase 91: Final Enterprise Features

### 1. Test User Assignments
- [ ] Tạo test user với role='user'
- [ ] Assign test user vào corporate "CORP001"
- [ ] Assign test user vào factory "FAC001"
- [ ] Login với test user
- [ ] Verify chỉ xem được inspections của CORP001/FAC001
- [ ] Verify không xem được inspections của corporates/factories khác

### 2. Apply Access Control to Statistics
- [ ] Update getYieldRateByCorporate để filter theo user assignments
- [ ] Update getYieldRateByFactory để filter theo user assignments
- [ ] Update getThroughputByCorporate để filter theo user assignments
- [ ] Update getThroughputByFactory để filter theo user assignments
- [ ] Update corporateFactoryStatsRouter để pass userId và userRole
- [ ] Update dashboardRouter.stats để filter theo user assignments

### 3. Dashboard Drill-down
- [ ] Update CorporateFactoryStats component để handle chart click events
- [ ] Thêm state management cho drill-down navigation
- [ ] Implement FactoryChart component với factory-level details
- [ ] Implement MachineAnalyticsTable component
- [ ] Thêm breadcrumb navigation
- [ ] Thêm back button để quay lại corporate view

### 4. API Documentation
- [x] Tạo API_DOCUMENTATION.md với tất cả endpoints
- [x] Document authentication và authorization
- [x] Document corporate/factory code integration
- [x] Document user assignment APIs
- [x] Document inspection APIs với access control
- [x] Document statistics APIs
- [x] Document import/export APIs
- [x] Document MQTT APIs
- [x] Document alert APIs
- [x] Thêm request/response examples
- [x] Thêm error codes và handling
- [x] Thêm rate limits và best practices


## Phase 92: Final Optimization & Features

### 1. Complete Access Control
- [x] Update getYieldRateByFactory với access control filtering
- [x] Update getThroughputByCorporate với access control filtering
- [x] Update getThroughputByFactory với access control filtering
- [x] Update corporateFactoryStatsRouter để pass userId và userRole

### 2. Dashboard Drill-down
- [x] Thêm state management cho drill-down (selectedCorporate, selectedFactory)
- [x] Update CorporateFactoryStats với click handlers cho charts
- [x] Thêm breadcrumb navigation component
- [x] Thêm back button để quay lại level trước
- [x] Pie chart phân bố sản lượng
- [x] Summary cards với trend indicators
- [x] Color-coded bars theo yield rate (green/yellow/red)

### 3. Performance Optimization
- [ ] Implement server-side caching cho statistics queries
- [ ] Thêm cache invalidation khi có inspection mới
- [ ] Update inspection list với configurable limit (max 1000)
- [ ] Implement cursor-based pagination cho large datasets
- [ ] Thêm loading states và skeleton UI
