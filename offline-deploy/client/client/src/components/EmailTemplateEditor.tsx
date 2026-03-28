import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Palette, 
  Type, 
  Image, 
  Mail, 
  Phone, 
  MapPin, 
  Link2, 
  Save, 
  Plus, 
  Trash2,
  Eye,
  Star,
  RefreshCw
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EmailTemplate {
  id: number;
  name: string;
  logoUrl: string | null;
  companyName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  warningColor: string | null;
  dangerColor: string | null;
  backgroundColor: string | null;
  fontFamily: string | null;
  footerText: string | null;
  footerLinks: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  socialLinks: string | null;
  isDefault: boolean;
  isActive: boolean;
}

const defaultTemplate: Omit<EmailTemplate, 'id'> = {
  name: 'New Template',
  logoUrl: null,
  companyName: 'AVI/AOI Management System',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  accentColor: '#10b981',
  warningColor: '#f59e0b',
  dangerColor: '#ef4444',
  backgroundColor: '#f8fafc',
  fontFamily: 'Arial, sans-serif',
  footerText: '© 2024 AVI/AOI Management System. All rights reserved.',
  footerLinks: null,
  contactEmail: null,
  contactPhone: null,
  contactAddress: null,
  socialLinks: null,
  isDefault: false,
  isActive: true,
};

const fontOptions = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: 'Open Sans, sans-serif', label: 'Open Sans' },
];

export function EmailTemplateEditor() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Omit<EmailTemplate, 'id'> & { id?: number }>(defaultTemplate);
  const [showPreview, setShowPreview] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const { t } = useTranslation();

  const { data: templates, refetch } = trpc.smtp.getEmailTemplates.useQuery();
  const createMutation = trpc.smtp.createEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('settings.email.createSuccess'));
      refetch();
      setShowCreateDialog(false);
      setNewTemplateName('');
    },
    onError: (error) => {
      toast.error(t('common.errorWithMessage', { message: error.message }));
    },
  });
  const updateMutation = trpc.smtp.updateEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('settings.email.updateSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.errorWithMessage', { message: error.message }));
    },
  });
  const deleteMutation = trpc.smtp.deleteEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('settings.email.deleteSuccess'));
      setSelectedTemplateId(null);
      setEditingTemplate(defaultTemplate);
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.errorWithMessage', { message: error.message }));
    },
  });
  const setDefaultMutation = trpc.smtp.setDefaultEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('settings.email.setDefaultSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.errorWithMessage', { message: error.message }));
    },
  });

  useEffect(() => {
    if (selectedTemplateId && templates) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        setEditingTemplate(template);
      }
    }
  }, [selectedTemplateId, templates]);

  const handleSave = () => {
    if (editingTemplate.id) {
      updateMutation.mutate({
        id: editingTemplate.id,
        name: editingTemplate.name,
        logoUrl: editingTemplate.logoUrl,
        companyName: editingTemplate.companyName,
        primaryColor: editingTemplate.primaryColor || undefined,
        secondaryColor: editingTemplate.secondaryColor || undefined,
        accentColor: editingTemplate.accentColor || undefined,
        warningColor: editingTemplate.warningColor || undefined,
        dangerColor: editingTemplate.dangerColor || undefined,
        backgroundColor: editingTemplate.backgroundColor || undefined,
        fontFamily: editingTemplate.fontFamily || undefined,
        footerText: editingTemplate.footerText,
        footerLinks: editingTemplate.footerLinks,
        contactEmail: editingTemplate.contactEmail,
        contactPhone: editingTemplate.contactPhone,
        contactAddress: editingTemplate.contactAddress,
        socialLinks: editingTemplate.socialLinks,
        isDefault: editingTemplate.isDefault,
        isActive: editingTemplate.isActive,
      });
    }
  };

  const handleCreate = () => {
    if (!newTemplateName.trim()) {
      toast.error(t('settings.email.nameRequired'));
      return;
    }
    createMutation.mutate({
      name: newTemplateName,
      logoUrl: defaultTemplate.logoUrl,
      companyName: defaultTemplate.companyName,
      primaryColor: defaultTemplate.primaryColor || undefined,
      secondaryColor: defaultTemplate.secondaryColor || undefined,
      accentColor: defaultTemplate.accentColor || undefined,
      warningColor: defaultTemplate.warningColor || undefined,
      dangerColor: defaultTemplate.dangerColor || undefined,
      backgroundColor: defaultTemplate.backgroundColor || undefined,
      fontFamily: defaultTemplate.fontFamily || undefined,
      footerText: defaultTemplate.footerText,
      footerLinks: defaultTemplate.footerLinks,
      contactEmail: defaultTemplate.contactEmail,
      contactPhone: defaultTemplate.contactPhone,
      contactAddress: defaultTemplate.contactAddress,
      socialLinks: defaultTemplate.socialLinks,
      isDefault: defaultTemplate.isDefault,
    });
  };

  const handleDelete = () => {
    if (editingTemplate.id && confirm(t('settings.email.confirmDelete'))) {
      deleteMutation.mutate({ id: editingTemplate.id });
    }
  };

  const handleSetDefault = () => {
    if (editingTemplate.id) {
      setDefaultMutation.mutate({ id: editingTemplate.id });
    }
  };

  const renderPreview = () => {
    return (
      <div 
        style={{ 
          fontFamily: editingTemplate.fontFamily || 'Arial, sans-serif',
          backgroundColor: editingTemplate.backgroundColor || '#f8fafc',
          padding: '20px',
          borderRadius: '8px',
        }}
      >
        {/* Header */}
        <div style={{ 
          backgroundColor: editingTemplate.primaryColor || '#2563eb',
          padding: '20px',
          borderRadius: '8px 8px 0 0',
          textAlign: 'center',
        }}>
          {editingTemplate.logoUrl && (
            <img 
              src={editingTemplate.logoUrl} 
              alt="Logo" 
              style={{ maxHeight: '60px', marginBottom: '10px' }}
            />
          )}
          <h1 style={{ color: 'white', margin: 0, fontSize: '24px' }}>
            {editingTemplate.companyName || 'Company Name'}
          </h1>
        </div>

        {/* Content */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '0 0 8px 8px',
        }}>
          <h2 style={{ color: editingTemplate.primaryColor || '#2563eb' }}>
            {t('settings.email.reportStats')}
          </h2>
          <p style={{ color: editingTemplate.secondaryColor || '#64748b' }}>
            {t('settings.email.sampleContent')}
          </p>

          {/* Stats example */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
            <div style={{ 
              flex: 1, 
              padding: '15px', 
              backgroundColor: editingTemplate.accentColor || '#10b981',
              borderRadius: '8px',
              color: 'white',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>98.5%</div>
              <div>Yield Rate</div>
            </div>
            <div style={{ 
              flex: 1, 
              padding: '15px', 
              backgroundColor: editingTemplate.warningColor || '#f59e0b',
              borderRadius: '8px',
              color: 'white',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>1.2%</div>
              <div>NG Rate</div>
            </div>
            <div style={{ 
              flex: 1, 
              padding: '15px', 
              backgroundColor: editingTemplate.dangerColor || '#ef4444',
              borderRadius: '8px',
              color: 'white',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>5</div>
              <div>Alerts</div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ 
            marginTop: '30px', 
            paddingTop: '20px', 
            borderTop: `1px solid ${editingTemplate.secondaryColor || '#64748b'}`,
            color: editingTemplate.secondaryColor || '#64748b',
            fontSize: '14px',
          }}>
            <p>{editingTemplate.footerText}</p>
            {editingTemplate.contactEmail && (
              <p>Email: {editingTemplate.contactEmail}</p>
            )}
            {editingTemplate.contactPhone && (
              <p>Phone: {editingTemplate.contactPhone}</p>
            )}
            {editingTemplate.contactAddress && (
              <p>Address: {editingTemplate.contactAddress}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Template Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Template Configuration
          </CardTitle>
          <CardDescription>
            {t('settings.email.customizeDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select
              value={selectedTemplateId?.toString() || ''}
              onValueChange={(value) => setSelectedTemplateId(Number(value))}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder={t('settings.email.selectTemplate')} />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id.toString()}>
                    {template.name} {template.isDefault && '⭐'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('settings.email.createNew')}
            </Button>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedTemplateId && (
        <>
          {/* Editor */}
          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="branding">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="branding">
                    <Image className="h-4 w-4 mr-2" />
                    Branding
                  </TabsTrigger>
                  <TabsTrigger value="colors">
                    <Palette className="h-4 w-4 mr-2" />
                    {t('settings.email.colors')}
                  </TabsTrigger>
                  <TabsTrigger value="typography">
                    <Type className="h-4 w-4 mr-2" />
                    Typography
                  </TabsTrigger>
                  <TabsTrigger value="contact">
                    <Phone className="h-4 w-4 mr-2" />
                    {t('settings.email.contact')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="branding" className="space-y-4 mt-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>{t('settings.email.templateName')}</Label>
                      <Input
                        value={editingTemplate.name}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Logo URL</Label>
                      <Input
                        placeholder="https://example.com/logo.png"
                        value={editingTemplate.logoUrl || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, logoUrl: e.target.value || null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.companyName')}</Label>
                      <Input
                        value={editingTemplate.companyName || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, companyName: e.target.value || null })}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="colors" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('settings.email.primaryColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.primaryColor || '#2563eb'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, primaryColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.primaryColor || '#2563eb'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, primaryColor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.secondaryColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.secondaryColor || '#64748b'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, secondaryColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.secondaryColor || '#64748b'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, secondaryColor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.accentColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.accentColor || '#10b981'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, accentColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.accentColor || '#10b981'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, accentColor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.warningColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.warningColor || '#f59e0b'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, warningColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.warningColor || '#f59e0b'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, warningColor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.dangerColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.dangerColor || '#ef4444'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, dangerColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.dangerColor || '#ef4444'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, dangerColor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('settings.email.backgroundColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingTemplate.backgroundColor || '#f8fafc'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, backgroundColor: e.target.value })}
                          className="w-16 h-10 p-1"
                        />
                        <Input
                          value={editingTemplate.backgroundColor || '#f8fafc'}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, backgroundColor: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="typography" className="space-y-4 mt-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Font Family</Label>
                      <Select
                        value={editingTemplate.fontFamily || 'Arial, sans-serif'}
                        onValueChange={(value) => setEditingTemplate({ ...editingTemplate, fontFamily: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {fontOptions.map((font) => (
                            <SelectItem key={font.value} value={font.value}>
                              <span style={{ fontFamily: font.value }}>{font.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Footer Text</Label>
                      <Textarea
                        value={editingTemplate.footerText || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, footerText: e.target.value || null })}
                        rows={3}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="contact" className="space-y-4 mt-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        {t('settings.email.contactEmail')}
                      </Label>
                      <Input
                        type="email"
                        placeholder="contact@company.com"
                        value={editingTemplate.contactEmail || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, contactEmail: e.target.value || null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {t('settings.email.contactPhone')}
                      </Label>
                      <Input
                        placeholder="+84 xxx xxx xxx"
                        value={editingTemplate.contactPhone || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, contactPhone: e.target.value || null })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        {t('settings.email.address')}
                      </Label>
                      <Textarea
                        placeholder="123 Street, City, Country"
                        value={editingTemplate.contactAddress || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, contactAddress: e.target.value || null })}
                        rows={2}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Actions */}
              <div className="flex items-center justify-between mt-6 pt-6 border-t">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingTemplate.isActive}
                      onCheckedChange={(checked) => setEditingTemplate({ ...editingTemplate, isActive: checked })}
                    />
                    <Label>{t('settings.email.activate')}</Label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowPreview(true)}>
                    <Eye className="h-4 w-4 mr-2" />
                    {t('settings.email.preview')}
                  </Button>
                  <Button variant="outline" onClick={handleSetDefault} disabled={editingTemplate.isDefault}>
                    <Star className="h-4 w-4 mr-2" />
                    {t('settings.email.setDefault')}
                  </Button>
                  <Button variant="destructive" onClick={handleDelete}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('common.delete')}
                  </Button>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    {updateMutation.isPending ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Preview Dialog */}
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('settings.email.previewTitle')}</DialogTitle>
                <DialogDescription>
                  {t('settings.email.previewDescription')}
                </DialogDescription>
              </DialogHeader>
              {renderPreview()}
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.email.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.email.createDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.email.templateName')}</Label>
              <Input
                placeholder={t('settings.email.namePlaceholder')}
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? t('settings.email.creating') : t('settings.email.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EmailTemplateEditor;
