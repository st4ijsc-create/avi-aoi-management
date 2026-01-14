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
