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
