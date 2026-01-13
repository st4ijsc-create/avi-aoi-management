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
