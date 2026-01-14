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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
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
