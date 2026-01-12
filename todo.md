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
- [ ] Create NTF history and statistics
- [ ] Add AI-assisted defect detection suggestions

## Phase 6: 2D/3D Layout Visualization
- [x] Create layout designer for factory floor plan
- [x] Implement 2D layout view with machine positions
- [ ] Add 3D visualization mode for factory layout
- [x] Display machine metrics on layout (Total, OK/NG/NTF, Yield)
- [ ] Enable click-to-view machine details from layout
- [x] Support multiple factory/workshop layouts

## Phase 7: Polish & Testing
- [x] Refine UI with elegant and perfect design principles
- [x] Add smooth animations and transitions
- [x] Implement responsive design for different screen sizes
- [x] Write unit tests for API endpoints
- [x] Write unit tests for core business logic
- [ ] Performance optimization for large datasets

## Phase 8: Documentation & Delivery
- [x] Create API documentation with examples
- [ ] Write user guide for dashboard and modules
- [ ] Document layout designer usage
- [ ] Prepare system architecture documentation
