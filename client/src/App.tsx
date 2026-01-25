import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import InspectionDetail from "./pages/InspectionDetail";
import Layout from "./pages/Layout";
import Settings from "./pages/Settings";
import ApiDocs from "./pages/ApiDocs";
import ProductModels from "./pages/ProductModels";
import CorporateLayout from "./pages/CorporateLayout";
import Reports from "./pages/Reports";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import ProductMachineMapping from "./pages/ProductMachineMapping";
import ProductionOrders from "./pages/ProductionOrders";
import MachineStatusMonitor from "./pages/MachineStatusMonitor";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import ChangePassword from "./pages/ChangePassword";
import AuditLogs from "./pages/AuditLogs";
import SessionManagement from "./pages/SessionManagement";
import { ProductComparison } from "./pages/ProductComparison";
import Setup from "./pages/Setup";
import MqttDashboard from "./pages/MqttDashboard";
import MqttAlertRules from "./pages/MqttAlertRules";
import SystemConfiguration from "./pages/SystemConfiguration";
import ImportExport from "./pages/ImportExport";
import UserAssignments from "./pages/UserAssignments";
import ScheduledReports from "./pages/ScheduledReports";
import SPCAnalysis from "./pages/SPCAnalysis";
import ProcessManagement from "./pages/ProcessManagement";
import WorkstationManagement from "./pages/WorkstationManagement";
import CategoryAnalytics from "./pages/CategoryAnalytics";
import UserGuide from "./pages/UserGuide";
import DashboardTemplates from "./pages/DashboardTemplates";
import BackupRestore from "./pages/BackupRestore";
import TemplateMarketplace from "./pages/TemplateMarketplace";
import OEEDashboard from "./pages/OEEDashboard";
import MQTTReplay from "./pages/MQTTReplay";
import OEETargetSettings from "./pages/OEETargetSettings";
import MachineHealthMonitoring from "./pages/MachineHealthMonitoring";
import DrillDownDashboard from "./pages/DrillDownDashboard";
import AnnotationStatistics from "./pages/AnnotationStatistics";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/history" component={History} />
      <Route path="/inspection/:id" component={InspectionDetail} />
      <Route path="/layout" component={Layout} />
      <Route path="/layout/:id" component={Layout} />
      <Route path="/settings" component={Settings} />
      <Route path="/api-docs" component={ApiDocs} />
      <Route path="/products" component={ProductModels} />
      <Route path="/corporate-layout" component={CorporateLayout} />
      <Route path="/reports" component={Reports} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/users" component={Users} />
            <Route path="/product-mapping" component={ProductMachineMapping} />
          <Route path="/production-orders" component={ProductionOrders} />
      <Route path="/machine-status" component={MachineStatusMonitor} />
      <Route path="/profile" component={Profile} />
      <Route path="/change-password" component={ChangePassword} />
      <Route path="/audit-logs" component={AuditLogs} />
      <Route path="/sessions" component={SessionManagement} />
      <Route path="/product-comparison" component={ProductComparison} />
      <Route path="/mqtt-dashboard" component={MqttDashboard} />
      <Route path="/mqtt-alerts" component={MqttAlertRules} />
      <Route path="/system-config" component={SystemConfiguration} />
      <Route path="/import-export" component={ImportExport} />
      <Route path="/user-assignments" component={UserAssignments} />
      <Route path="/scheduled-reports" component={ScheduledReports} />
      <Route path="/spc-analysis" component={SPCAnalysis} />
      <Route path="/process-management" component={ProcessManagement} />
      <Route path="/workstation-management" component={WorkstationManagement} />
      <Route path="/category-analytics" component={CategoryAnalytics} />
      <Route path="/user-guide" component={UserGuide} />
      <Route path="/dashboard-templates" component={DashboardTemplates} />
      <Route path="/backup-restore" component={BackupRestore} />
      <Route path="/template-marketplace" component={TemplateMarketplace} />
      <Route path="/oee-dashboard" component={OEEDashboard} />
      <Route path="/mqtt-replay" component={MQTTReplay} />
      <Route path="/oee-target-settings" component={OEETargetSettings} />
      <Route path="/machine-health" component={MachineHealthMonitoring} />
      <Route path="/drill-down" component={DrillDownDashboard} />
      <Route path="/annotation-statistics" component={AnnotationStatistics} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
