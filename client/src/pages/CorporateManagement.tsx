import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { navItems } from "@/lib/navigation";
import {
  Building2,
  Warehouse,
  Factory,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Users,
  MapPin,
  Globe,
  Search,
  Network,
  Layers,
  Settings2,
  RefreshCw,
  Link2,
  Unlink,
  Eye,
  ArrowRight,
  Phone,
  Mail,
  FileText,
  Image,
  Loader2,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface FactoryFormData {
  code: string;
  name: string;
  description: string;
  address: string;
  region: string;
  country: string;
}

interface WorkshopFormData {
  code: string;
  name: string;
  description: string;
  factoryId: number;
  floorArea: string;
}

export default function CorporateManagement() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("hierarchy");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  
  // Factory form state
  const [showFactoryDialog, setShowFactoryDialog] = useState(false);
  const [editingFactory, setEditingFactory] = useState<any | null>(null);
  const [factoryForm, setFactoryForm] = useState<FactoryFormData>({
    code: "", name: "", description: "", address: "", region: "", country: ""
  });
  
  // Workshop form state
  const [showWorkshopDialog, setShowWorkshopDialog] = useState(false);
  const [editingWorkshop, setEditingWorkshop] = useState<any | null>(null);
  const [workshopForm, setWorkshopForm] = useState<WorkshopFormData>({
    code: "", name: "", description: "", factoryId: 0, floorArea: ""
  });
  
  // Corporate info form state
  const [corporateInfo, setCorporateInfo] = useState({
    corporateName: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    taxId: "",
    logoUrl: "",
    description: "",
  });
  const [corporateInfoDirty, setCorporateInfoDirty] = useState(false);
  
  // Data queries
  const { data: factories, refetch: refetchFactories } = trpc.factory.list.useQuery();
  const { data: workshops, refetch: refetchWorkshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: stations } = trpc.station.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: userAssignments } = trpc.userAssignment.getAllUserAssignments.useQuery();

  // Corporate settings query
  const { data: corporateSettings, isLoading: corporateSettingsLoading } = trpc.system.settings.getByCategory.useQuery(
    { category: "corporate" },
    { enabled: activeTab === "corporate-settings" }
  );

  // Corporate settings mutation
  const saveCorporateSettingsMutation = trpc.system.settings.bulkUpsert.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.settingsSaved', 'Corporate settings saved'));
      setCorporateInfoDirty(false);
    },
    onError: (err) => toast.error(err.message),
  });

  // Load corporate settings into form when data arrives
  useEffect(() => {
    if (corporateSettings && corporateSettings.length > 0) {
      const settingsMap: Record<string, string> = {};
      for (const s of corporateSettings) {
        // Strip "corporate." prefix from the key
        const shortKey = s.settingKey.startsWith("corporate.") 
          ? s.settingKey.slice("corporate.".length) 
          : s.settingKey;
        settingsMap[shortKey] = s.settingValue || "";
      }
      setCorporateInfo({
        corporateName: settingsMap.corporateName || "",
        address: settingsMap.address || "",
        phone: settingsMap.phone || "",
        email: settingsMap.email || "",
        website: settingsMap.website || "",
        taxId: settingsMap.taxId || "",
        logoUrl: settingsMap.logoUrl || "",
        description: settingsMap.description || "",
      });
      setCorporateInfoDirty(false);
    }
  }, [corporateSettings]);

  const handleCorporateInfoChange = (field: keyof typeof corporateInfo, value: string) => {
    setCorporateInfo(prev => ({ ...prev, [field]: value }));
    setCorporateInfoDirty(true);
  };

  const handleSaveCorporateInfo = () => {
    const settings = Object.entries(corporateInfo).map(([key, value]) => ({
      key: `corporate.${key}`,
      value: value || "",
    }));
    saveCorporateSettingsMutation.mutate({
      category: "corporate",
      settings,
    });
  };

  // Mutations
  const createFactoryMutation = trpc.factory.create.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.factoryCreated', 'Factory created successfully'));
      refetchFactories();
      setShowFactoryDialog(false);
      resetFactoryForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateFactoryMutation = trpc.factory.update.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.factoryUpdated', 'Factory updated successfully'));
      refetchFactories();
      setShowFactoryDialog(false);
      resetFactoryForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteFactoryMutation = trpc.factory.delete.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.factoryDeleted', 'Factory deleted'));
      refetchFactories();
    },
    onError: (err) => toast.error(err.message),
  });

  const createWorkshopMutation = trpc.workshop.create.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.workshopCreated', 'Workshop created successfully'));
      refetchWorkshops();
      setShowWorkshopDialog(false);
      resetWorkshopForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateWorkshopMutation = trpc.workshop.update.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.workshopUpdated', 'Workshop updated successfully'));
      refetchWorkshops();
      setShowWorkshopDialog(false);
      resetWorkshopForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteWorkshopMutation = trpc.workshop.delete.useMutation({
    onSuccess: () => {
      toast.success(t('corporate.workshopDeleted', 'Workshop deleted'));
      refetchWorkshops();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetFactoryForm = () => {
    setFactoryForm({ code: "", name: "", description: "", address: "", region: "", country: "" });
    setEditingFactory(null);
  };

  const resetWorkshopForm = () => {
    setWorkshopForm({ code: "", name: "", description: "", factoryId: 0, floorArea: "" });
    setEditingWorkshop(null);
  };

  const openEditFactory = (factory: any) => {
    setEditingFactory(factory);
    setFactoryForm({
      code: factory.code || "",
      name: factory.name || "",
      description: factory.description || "",
      address: factory.address || "",
      region: factory.region || "",
      country: factory.country || "",
    });
    setShowFactoryDialog(true);
  };

  const openEditWorkshop = (workshop: any) => {
    setEditingWorkshop(workshop);
    setWorkshopForm({
      code: workshop.code || "",
      name: workshop.name || "",
      description: workshop.description || "",
      factoryId: workshop.factoryId || 0,
      floorArea: workshop.floorArea ? String(workshop.floorArea) : "",
    });
    setShowWorkshopDialog(true);
  };

  const handleSaveFactory = () => {
    if (editingFactory) {
      updateFactoryMutation.mutate({ id: editingFactory.id, ...factoryForm });
    } else {
      createFactoryMutation.mutate(factoryForm);
    }
  };

  const handleSaveWorkshop = () => {
    if (editingWorkshop) {
      updateWorkshopMutation.mutate({ id: editingWorkshop.id, ...workshopForm });
    } else {
      createWorkshopMutation.mutate(workshopForm);
    }
  };

  // Toggle tree node expansion
  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Expand all / collapse all
  const expandAll = () => {
    const allNodeIds = new Set<string>();
    factories?.forEach(f => {
      allNodeIds.add(`factory-${f.id}`);
      const fWorkshops = workshops?.filter(w => w.factoryId === f.id) || [];
      fWorkshops.forEach(w => {
        allNodeIds.add(`workshop-${w.id}`);
        const wLines = lines?.filter(l => l.workshopId === w.id) || [];
        wLines.forEach(l => {
          allNodeIds.add(`line-${l.id}`);
          const lStations = stations?.filter(s => s.lineId === l.id) || [];
          lStations.forEach(s => {
            allNodeIds.add(`station-${s.id}`);
          });
        });
      });
    });
    setExpandedNodes(allNodeIds);
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Hierarchy data
  const hierarchyData = useMemo(() => {
    if (!factories) return [];
    
    return factories.map(factory => {
      const factoryWorkshops = (workshops || []).filter(w => w.factoryId === factory.id);
      
      return {
        ...factory,
        workshops: factoryWorkshops.map(workshop => {
          const workshopLines = (lines || []).filter(l => l.workshopId === workshop.id);
          
          return {
            ...workshop,
            lines: workshopLines.map(line => {
              const lineStations = (stations || []).filter(s => s.lineId === line.id);
              
              return {
                ...line,
                stations: lineStations.map(station => {
                  const stationMachines = (machines || []).filter(m => m.stationId === station.id);
                  return { ...station, machines: stationMachines };
                }),
              };
            }),
          };
        }),
      };
    });
  }, [factories, workshops, lines, stations, machines]);

  // Corporate groups (unique corporateCode values from user assignments)
  const corporateGroups = useMemo(() => {
    if (!userAssignments) return [];
    const groups: Record<string, { code: string; userCount: number; users: string[] }> = {};
    userAssignments.forEach((ua: any) => {
      ua.corporates?.forEach((corp: any) => {
        if (!groups[corp.corporateCode]) {
          groups[corp.corporateCode] = { code: corp.corporateCode, userCount: 0, users: [] };
        }
        groups[corp.corporateCode].userCount++;
        groups[corp.corporateCode].users.push(ua.user.username || ua.user.email || `User #${ua.user.id}`);
      });
    });
    return Object.values(groups);
  }, [userAssignments]);

  // Filter by search
  const filteredFactories = useMemo(() => {
    if (!searchQuery) return hierarchyData;
    const q = searchQuery.toLowerCase();
    return hierarchyData.filter(f => 
      f.name.toLowerCase().includes(q) || 
      f.code.toLowerCase().includes(q) ||
      (f.region && f.region.toLowerCase().includes(q)) ||
      (f.country && f.country.toLowerCase().includes(q)) ||
      f.workshops.some(w => 
        w.name.toLowerCase().includes(q) || 
        w.code.toLowerCase().includes(q)
      )
    );
  }, [hierarchyData, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    factories: factories?.length || 0,
    workshops: workshops?.length || 0,
    lines: lines?.length || 0,
    stations: stations?.length || 0,
    machines: machines?.length || 0,
    corporateGroups: corporateGroups.length,
  }), [factories, workshops, lines, stations, machines, corporateGroups]);

  if (authLoading) {
    return (
      <DashboardLayout title={t('corporate.corporateManagement', 'Corporate Management')} navItems={navItems} currentPath="/corporate-management">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('corporate.corporateManagement', 'Corporate Management')} navItems={navItems} currentPath="/corporate-management">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              {t('corporate.corporateManagement', 'Corporate Management')}
              <ViewOnlyBadge module="corporate_management" />
            </h1>
            <p className="text-muted-foreground">{t('corporate.corporateManagementDesc', 'Manage organizational hierarchy and factory relationships')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchFactories(); refetchWorkshops(); }}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.factories}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.factories')}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Warehouse className="h-4 w-4 text-cyan-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.workshops}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.workshops')}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Layers className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.lines}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.productionLine')}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Settings2 className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.stations}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.stations', 'Stations')}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Factory className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.machines}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.machines')}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/10">
                <Network className="h-4 w-4 text-rose-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.corporateGroups}</p>
                <p className="text-xs text-muted-foreground">{t('corporate.companies')}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="hierarchy" className="gap-1">
              <Network className="h-4 w-4" />
              {t('corporate.hierarchy', 'Hierarchy')}
            </TabsTrigger>
            <TabsTrigger value="factories" className="gap-1">
              <Building2 className="h-4 w-4" />
              {t('corporate.factories')}
            </TabsTrigger>
            <TabsTrigger value="corporate-groups" className="gap-1">
              <Globe className="h-4 w-4" />
              {t('corporate.companies')}
            </TabsTrigger>
            <TabsTrigger value="corporate-settings" className="gap-1">
              <Settings2 className="h-4 w-4" />
              {t('corporate.corporateSettings', 'Corporate Info')}
            </TabsTrigger>
          </TabsList>

          {/* Hierarchy Tree Tab */}
          <TabsContent value="hierarchy" className="mt-4">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Network className="h-5 w-5 text-primary" />
                      {t('corporate.organizationHierarchy', 'Organization Hierarchy')}
                    </CardTitle>
                    <CardDescription>{t('corporate.hierarchyDesc', 'Complete organizational structure from factories to machines')}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={expandAll}>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      {t('common.expandAll', 'Expand All')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}>
                      <ChevronRight className="h-4 w-4 mr-1" />
                      {t('common.collapseAll', 'Collapse All')}
                    </Button>
                  </div>
                </div>
                <div className="relative mt-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t('corporate.searchHierarchy', 'Search factories, workshops...')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {filteredFactories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Building2 className="h-12 w-12 mb-3 opacity-30" />
                      <p className="text-lg font-medium">{t('corporate.noFactoriesFound', 'No factories found')}</p>
                      <p className="text-sm">{t('corporate.addFirstFactory', 'Add your first factory to get started')}</p>
                      <Button variant="outline" className="mt-4" onClick={() => setShowFactoryDialog(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        {t('corporate.addFactory', 'Add Factory')}
                      </Button>
                    </div>
                  ) : (
                    filteredFactories.map(factory => (
                      <div key={factory.id} className="border rounded-lg overflow-hidden">
                        {/* Factory Level */}
                        <div 
                          className="flex items-center gap-2 p-3 hover:bg-accent/50 cursor-pointer transition-colors group"
                          onClick={() => toggleNode(`factory-${factory.id}`)}
                        >
                          <button className="shrink-0 text-muted-foreground hover:text-foreground">
                            {expandedNodes.has(`factory-${factory.id}`) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <Building2 className="h-5 w-5 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{factory.name}</span>
                              <Badge variant="outline" className="text-xs">{factory.code}</Badge>
                              {factory.isActive !== false && (
                                <Badge className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              {factory.region && <span className="flex items-center gap-0.5"><Globe className="h-3 w-3" />{factory.region}</span>}
                              {factory.country && <span>{factory.country}</span>}
                              <span>{factory.workshops.length} {t('corporate.workshops')}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); openEditFactory(factory); }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setLocation(`/corporate-layout`); }}>
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={(e) => { 
                              e.stopPropagation(); 
                              if (confirm(t('corporate.confirmDeleteFactory', 'Are you sure you want to delete this factory?'))) {
                                deleteFactoryMutation.mutate({ id: factory.id });
                              }
                            }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Workshop Level */}
                        {expandedNodes.has(`factory-${factory.id}`) && (
                          <div className="border-t bg-accent/20">
                            {factory.workshops.length === 0 ? (
                              <div className="py-4 px-8 text-sm text-muted-foreground text-center">
                                {t('corporate.noWorkshops', 'No workshops in this factory')}
                                <Button 
                                  variant="link" size="sm" className="ml-2"
                                  onClick={() => {
                                    setWorkshopForm({ ...workshopForm, factoryId: factory.id });
                                    setShowWorkshopDialog(true);
                                  }}
                                >
                                  <Plus className="h-3 w-3 mr-1" /> {t('corporate.addWorkshop', 'Add Workshop')}
                                </Button>
                              </div>
                            ) : (
                              factory.workshops.map(workshop => (
                                <div key={workshop.id}>
                                  <div 
                                    className="flex items-center gap-2 p-2 pl-10 hover:bg-accent/50 cursor-pointer transition-colors group"
                                    onClick={() => toggleNode(`workshop-${workshop.id}`)}
                                  >
                                    <button className="shrink-0 text-muted-foreground hover:text-foreground">
                                      {expandedNodes.has(`workshop-${workshop.id}`) ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </button>
                                    <Warehouse className="h-4 w-4 text-cyan-500 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{workshop.name}</span>
                                        <Badge variant="outline" className="text-xs">{workshop.code}</Badge>
                                      </div>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{workshop.lines.length} {t('corporate.productionLine')}</span>
                                        {workshop.floorArea && <span>· {workshop.floorArea} m²</span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); openEditWorkshop(workshop); }}>
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setLocation(`/layout?workshopId=${workshop.id}`); }}>
                                        <Eye className="h-3 w-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={(e) => { 
                                        e.stopPropagation();
                                        if (confirm(t('corporate.confirmDeleteWorkshop', 'Delete this workshop?'))) {
                                          deleteWorkshopMutation.mutate({ id: workshop.id });
                                        }
                                      }}>
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>

                                  {/* Line Level */}
                                  {expandedNodes.has(`workshop-${workshop.id}`) && (
                                    <div className="border-t border-dashed">
                                      {workshop.lines.length === 0 ? (
                                        <div className="py-3 px-16 text-xs text-muted-foreground text-center">
                                          {t('corporate.noLines', 'No production lines')}
                                        </div>
                                      ) : (
                                        workshop.lines.map(line => (
                                          <div key={line.id}>
                                            <div 
                                              className="flex items-center gap-2 p-2 pl-16 hover:bg-accent/30 cursor-pointer transition-colors group"
                                              onClick={() => toggleNode(`line-${line.id}`)}
                                            >
                                              <button className="shrink-0 text-muted-foreground hover:text-foreground">
                                                {expandedNodes.has(`line-${line.id}`) ? (
                                                  <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                  <ChevronRight className="h-3 w-3" />
                                                )}
                                              </button>
                                              <Layers className="h-4 w-4 text-emerald-500 shrink-0" />
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-sm">{line.name}</span>
                                                  <Badge variant="outline" className="text-xs">{line.code}</Badge>
                                                </div>
                                                <span className="text-xs text-muted-foreground">{line.stations.length} stations</span>
                                              </div>
                                            </div>

                                            {/* Station + Machine Level */}
                                            {expandedNodes.has(`line-${line.id}`) && (
                                              <div className="border-t border-dotted">
                                                {line.stations.length === 0 ? (
                                                  <div className="py-2 px-24 text-xs text-muted-foreground">{t('corporate.noStations', 'No stations')}</div>
                                                ) : (
                                                  line.stations.map(station => (
                                                    <div key={station.id}>
                                                      <div 
                                                        className="flex items-center gap-2 p-1.5 pl-24 hover:bg-accent/20 cursor-pointer transition-colors group"
                                                        onClick={() => toggleNode(`station-${station.id}`)}
                                                      >
                                                        <button className="shrink-0 text-muted-foreground hover:text-foreground">
                                                          {expandedNodes.has(`station-${station.id}`) ? (
                                                            <ChevronDown className="h-3 w-3" />
                                                          ) : (
                                                            <ChevronRight className="h-3 w-3" />
                                                          )}
                                                        </button>
                                                        <Settings2 className="h-3 w-3 text-amber-500 shrink-0" />
                                                        <span className="text-xs">{station.name}</span>
                                                        <Badge variant="outline" className="text-[10px] px-1">{station.code}</Badge>
                                                        <span className="text-[10px] text-muted-foreground">{station.machines.length} machines</span>
                                                      </div>

                                                      {expandedNodes.has(`station-${station.id}`) && station.machines.length > 0 && (
                                                        <div className="border-t border-dotted">
                                                          {station.machines.map(machine => (
                                                            <div key={machine.id} className="flex items-center gap-2 p-1 pl-32 hover:bg-accent/10 group">
                                                              <Factory className="h-3 w-3 text-violet-500 shrink-0" />
                                                              <span className="text-xs">{machine.name}</span>
                                                              <Badge variant="outline" className="text-[10px] px-1">{machine.code}</Badge>
                                                              <Badge variant={machine.operationStatus === 'running' ? 'default' : 'secondary'} className="text-[10px] px-1">
                                                                {machine.operationStatus || 'idle'}
                                                              </Badge>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      )}
                                                    </div>
                                                  ))
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                            {/* Add workshop button at the bottom of factory */}
                            {factory.workshops.length > 0 && (
                              <div className="border-t p-2 pl-10">
                                <Button 
                                  variant="ghost" size="sm" className="h-7 text-xs"
                                  onClick={() => {
                                    setWorkshopForm({ ...workshopForm, factoryId: factory.id });
                                    setShowWorkshopDialog(true);
                                  }}
                                >
                                  <Plus className="h-3 w-3 mr-1" /> {t('corporate.addWorkshop', 'Add Workshop')}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Factories Tab */}
          <TabsContent value="factories" className="mt-4">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{t('corporate.factoryManagement', 'Factory Management')}</CardTitle>
                    <CardDescription>{t('corporate.factoryManagementDesc', 'Add, edit, and manage factory information')}</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => { resetFactoryForm(); setShowFactoryDialog(true); }}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t('corporate.addFactory', 'Add Factory')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {factories?.map(factory => {
                    const factoryWorkshops = workshops?.filter(w => w.factoryId === factory.id) || [];
                    const factoryLines = factoryWorkshops.flatMap(w => lines?.filter(l => l.workshopId === w.id) || []);
                    const factoryStations = factoryLines.flatMap(l => stations?.filter(s => s.lineId === l.id) || []);
                    const factoryMachines = factoryStations.flatMap(s => machines?.filter(m => m.stationId === s.id) || []);
                    
                    return (
                      <Card key={factory.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className="p-2 rounded-lg bg-primary/10">
                                <Building2 className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-semibold text-foreground">{factory.name}</h3>
                                <p className="text-xs text-muted-foreground">{factory.code}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditFactory(factory)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                                if (confirm(t('corporate.confirmDeleteFactory', 'Delete this factory?'))) {
                                  deleteFactoryMutation.mutate({ id: factory.id });
                                }
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          
                          {(factory.address || factory.region || factory.country) && (
                            <div className="text-xs text-muted-foreground space-y-1">
                              {factory.address && (
                                <p className="flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" />{factory.address}</p>
                              )}
                              {(factory.region || factory.country) && (
                                <p className="flex items-center gap-1"><Globe className="h-3 w-3 shrink-0" />{[factory.region, factory.country].filter(Boolean).join(", ")}</p>
                              )}
                            </div>
                          )}
                          
                          {factory.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{factory.description}</p>
                          )}
                          
                          <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                            <div className="text-center">
                              <p className="text-sm font-bold">{factoryWorkshops.length}</p>
                              <p className="text-[10px] text-muted-foreground">{t('corporate.workshops')}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold">{factoryLines.length}</p>
                              <p className="text-[10px] text-muted-foreground">{t('corporate.productionLine')}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold">{factoryStations.length}</p>
                              <p className="text-[10px] text-muted-foreground">{t('corporate.stations', 'Stations')}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold">{factoryMachines.length}</p>
                              <p className="text-[10px] text-muted-foreground">{t('corporate.machines')}</p>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-1">
                            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setLocation(`/layout?factoryId=${factory.id}`)}>
                              <Eye className="h-3 w-3 mr-1" />
                              {t('corporate.viewDetailedLayout')}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Corporate Groups Tab */}
          <TabsContent value="corporate-groups" className="mt-4">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  {t('corporate.corporateGroups', 'Corporate Groups')}
                </CardTitle>
                <CardDescription>{t('corporate.corporateGroupsDesc', 'View corporate group assignments and their members')}</CardDescription>
              </CardHeader>
              <CardContent>
                {corporateGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Network className="h-12 w-12 mb-3 opacity-30" />
                    <p className="font-medium">{t('corporate.noCorporateGroups', 'No corporate groups configured')}</p>
                    <p className="text-sm mt-1">{t('corporate.assignUsersFirst', 'Assign users to corporate groups in User Assignments page')}</p>
                    <Button variant="outline" className="mt-4" onClick={() => setLocation('/user-assignments')}>
                      <ArrowRight className="h-4 w-4 mr-1" />
                      {t('corporate.goToUserAssignments', 'Go to User Assignments')}
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {corporateGroups.map((group) => (
                      <Card key={group.code} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <Network className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-semibold">{group.code}</h3>
                              <p className="text-xs text-muted-foreground">{t('corporate.corporation')}</p>
                            </div>
                          </div>
                          
                          <div className="p-3 rounded-lg bg-secondary/30 mb-3">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{group.userCount} {t('corporate.assignedUsers', 'Assigned Users')}</span>
                            </div>
                          </div>
                          
                          <div className="space-y-1.5 max-h-32 overflow-y-auto">
                            {group.users.map((user, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold">
                                  {user.charAt(0).toUpperCase()}
                                </div>
                                <span>{user}</span>
                              </div>
                            ))}
                          </div>
                          
                          <Button variant="outline" size="sm" className="w-full mt-3 h-7 text-xs" onClick={() => setLocation('/user-assignments')}>
                            <Settings2 className="h-3 w-3 mr-1" />
                            {t('corporate.manageAssignments', 'Manage Assignments')}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Corporate Settings Tab */}
          <TabsContent value="corporate-settings" className="mt-4">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings2 className="h-5 w-5 text-primary" />
                      {t('corporate.corporateSettings', 'Corporate Info')}
                    </CardTitle>
                    <CardDescription>{t('corporate.corporateSettingsDesc', 'General information about the corporation/organization')}</CardDescription>
                  </div>
                  <Button
                    onClick={handleSaveCorporateInfo}
                    disabled={!corporateInfoDirty || saveCorporateSettingsMutation.isPending}
                  >
                    {saveCorporateSettingsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    {t('common.save', 'Save')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {corporateSettingsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Basic Info */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                        {t('corporate.basicInfo', 'Basic Information')}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <Label className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" />
                            {t('corporate.corporateName', 'Corporate Name')}
                          </Label>
                          <Input
                            value={corporateInfo.corporateName}
                            onChange={e => handleCorporateInfoChange('corporateName', e.target.value)}
                            placeholder={t('corporate.corporateNamePlaceholder', 'e.g. AVI Corporation')}
                            className="mt-1"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            {t('corporate.address', 'Address')}
                          </Label>
                          <Textarea
                            value={corporateInfo.address}
                            onChange={e => handleCorporateInfoChange('address', e.target.value)}
                            placeholder={t('corporate.addressPlaceholder', 'Full address of the corporate headquarters')}
                            rows={2}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5" />
                            {t('corporate.taxId', 'Tax ID / Business Registration')}
                          </Label>
                          <Input
                            value={corporateInfo.taxId}
                            onChange={e => handleCorporateInfoChange('taxId', e.target.value)}
                            placeholder={t('corporate.taxIdPlaceholder', 'e.g. 0101234567')}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <Image className="h-3.5 w-3.5" />
                            {t('corporate.logoUrl', 'Logo URL')}
                          </Label>
                          <Input
                            value={corporateInfo.logoUrl}
                            onChange={e => handleCorporateInfoChange('logoUrl', e.target.value)}
                            placeholder={t('corporate.logoUrlPlaceholder', 'https://example.com/logo.png')}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Contact Info */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                        {t('corporate.contactInfo', 'Contact Information')}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            {t('corporate.phone', 'Phone')}
                          </Label>
                          <Input
                            value={corporateInfo.phone}
                            onChange={e => handleCorporateInfoChange('phone', e.target.value)}
                            placeholder={t('corporate.phonePlaceholder', 'e.g. +84 28 1234 5678')}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" />
                            {t('corporate.email', 'Email')}
                          </Label>
                          <Input
                            type="email"
                            value={corporateInfo.email}
                            onChange={e => handleCorporateInfoChange('email', e.target.value)}
                            placeholder={t('corporate.emailPlaceholder', 'e.g. info@company.com')}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5" />
                            {t('corporate.website', 'Website')}
                          </Label>
                          <Input
                            value={corporateInfo.website}
                            onChange={e => handleCorporateInfoChange('website', e.target.value)}
                            placeholder={t('corporate.websitePlaceholder', 'e.g. https://www.company.com')}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                        {t('corporate.descriptionSection', 'Description')}
                      </h3>
                      <Textarea
                        value={corporateInfo.description}
                        onChange={e => handleCorporateInfoChange('description', e.target.value)}
                        placeholder={t('corporate.descriptionPlaceholder', 'Brief description about the corporation...')}
                        rows={4}
                      />
                    </div>

                    {/* Logo Preview */}
                    {corporateInfo.logoUrl && (
                      <div>
                        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                          {t('corporate.logoPreview', 'Logo Preview')}
                        </h3>
                        <div className="border rounded-lg p-4 bg-secondary/20 flex items-center justify-center">
                          <img
                            src={corporateInfo.logoUrl}
                            alt="Corporate Logo"
                            className="max-h-24 max-w-[200px] object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Factory Dialog */}
      <Dialog open={showFactoryDialog} onOpenChange={(open) => { if (!open) { setShowFactoryDialog(false); resetFactoryForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFactory ? t('corporate.editFactory', 'Edit Factory') : t('corporate.addFactory', 'Add Factory')}
            </DialogTitle>
            <DialogDescription>
              {editingFactory ? t('corporate.editFactoryDesc', 'Update factory information') : t('corporate.addFactoryDesc', 'Add a new factory to the organization')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('corporate.factoryCode', 'Code')}</Label>
                <Input 
                  value={factoryForm.code} 
                  onChange={e => setFactoryForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. FAC-001"
                  disabled={!!editingFactory}
                />
              </div>
              <div>
                <Label>{t('corporate.factoryName', 'Name')}</Label>
                <Input 
                  value={factoryForm.name} 
                  onChange={e => setFactoryForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Ha Noi Factory"
                />
              </div>
            </div>
            <div>
              <Label>{t('corporate.description', 'Description')}</Label>
              <Textarea 
                value={factoryForm.description} 
                onChange={e => setFactoryForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('corporate.factoryDescPlaceholder', 'Brief description of the factory...')}
                rows={2}
              />
            </div>
            <div>
              <Label>{t('corporate.address', 'Address')}</Label>
              <Input 
                value={factoryForm.address} 
                onChange={e => setFactoryForm(f => ({ ...f, address: e.target.value }))}
                placeholder={t('corporate.addressPlaceholder', '123 Industrial Zone...')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('corporate.region', 'Region')}</Label>
                <Input 
                  value={factoryForm.region} 
                  onChange={e => setFactoryForm(f => ({ ...f, region: e.target.value }))}
                  placeholder="e.g. Asia Pacific"
                />
              </div>
              <div>
                <Label>{t('corporate.country', 'Country')}</Label>
                <Input 
                  value={factoryForm.country} 
                  onChange={e => setFactoryForm(f => ({ ...f, country: e.target.value }))}
                  placeholder="e.g. Vietnam"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFactoryDialog(false); resetFactoryForm(); }}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSaveFactory} disabled={!factoryForm.code || !factoryForm.name}>
              <Save className="h-4 w-4 mr-1" />
              {editingFactory ? t('common.save', 'Save') : t('corporate.createFactory', 'Create Factory')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workshop Dialog */}
      <Dialog open={showWorkshopDialog} onOpenChange={(open) => { if (!open) { setShowWorkshopDialog(false); resetWorkshopForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingWorkshop ? t('corporate.editWorkshop', 'Edit Workshop') : t('corporate.addWorkshop', 'Add Workshop')}
            </DialogTitle>
            <DialogDescription>
              {editingWorkshop ? t('corporate.editWorkshopDesc', 'Update workshop information') : t('corporate.addWorkshopDesc', 'Add a new workshop to a factory')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('corporate.factory')}</Label>
              <Select 
                value={workshopForm.factoryId ? String(workshopForm.factoryId) : undefined}
                onValueChange={v => setWorkshopForm(f => ({ ...f, factoryId: parseInt(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('corporate.selectFactory', 'Select factory')} />
                </SelectTrigger>
                <SelectContent>
                  {factories?.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name} ({f.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('corporate.workshopCode', 'Code')}</Label>
                <Input 
                  value={workshopForm.code} 
                  onChange={e => setWorkshopForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. WS-001"
                />
              </div>
              <div>
                <Label>{t('corporate.workshopName', 'Name')}</Label>
                <Input 
                  value={workshopForm.name} 
                  onChange={e => setWorkshopForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Assembly Workshop"
                />
              </div>
            </div>
            <div>
              <Label>{t('corporate.description', 'Description')}</Label>
              <Textarea 
                value={workshopForm.description} 
                onChange={e => setWorkshopForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div>
              <Label>{t('corporate.floorArea', 'Floor Area (m²)')}</Label>
              <Input 
                type="number"
                value={workshopForm.floorArea} 
                onChange={e => setWorkshopForm(f => ({ ...f, floorArea: e.target.value }))}
                placeholder="e.g. 2000"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowWorkshopDialog(false); resetWorkshopForm(); }}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSaveWorkshop} disabled={!workshopForm.code || !workshopForm.name || !workshopForm.factoryId}>
              <Save className="h-4 w-4 mr-1" />
              {editingWorkshop ? t('common.save', 'Save') : t('corporate.createWorkshop', 'Create Workshop')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
