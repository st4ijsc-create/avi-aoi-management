import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { 
  Activity, 
  BarChart3, 
  Box, 
  CheckCircle2, 
  Cpu, 
  History, 
  LayoutGrid, 
  LogIn, 
  Settings,
  Zap,
  Eye,
  Brain
} from "lucide-react";
import { Link } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  const features = [
    {
      icon: <Activity className="h-8 w-8" />,
      title: "Dashboard Realtime",
      description: "Theo dõi trực tiếp Total Product, OK/NG/NTF và Yield Rate từ tất cả máy kết nối"
    },
    {
      icon: <History className="h-8 w-8" />,
      title: "Lịch sử & Tìm kiếm",
      description: "Tìm kiếm dữ liệu theo mã nhà máy, nhà xưởng, SN sản phẩm, dây chuyền, công trạm"
    },
    {
      icon: <Eye className="h-8 w-8" />,
      title: "Chi tiết Điểm đo",
      description: "Xem ảnh, giá trị đo, so sánh với ảnh mẫu và xác nhận NTF khi cần"
    },
    {
      icon: <Brain className="h-8 w-8" />,
      title: "AI Phân tích",
      description: "Hỗ trợ AI phân tích hình ảnh và đưa ra đánh giá chất lượng tự động"
    },
    {
      icon: <LayoutGrid className="h-8 w-8" />,
      title: "Layout 2D/3D",
      description: "Trực quan hóa nhà xưởng với layout 2D/3D hiển thị thông tin máy realtime"
    },
    {
      icon: <Cpu className="h-8 w-8" />,
      title: "API Tích hợp",
      description: "API chuẩn để máy AVI/AOI gửi dữ liệu kiểm tra vào hệ thống"
    }
  ];

  const stats = [
    { label: "Máy kết nối", value: "50+", icon: <Cpu className="h-5 w-5" /> },
    { label: "Sản phẩm/ngày", value: "100K+", icon: <Box className="h-5 w-5" /> },
    { label: "Yield Rate", value: "99.5%", icon: <CheckCircle2 className="h-5 w-5" /> },
    { label: "Uptime", value: "99.9%", icon: <Zap className="h-5 w-5" /> }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center glow-primary">
              <Cpu className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">AVI/AOI Management</h1>
              <p className="text-xs text-muted-foreground">Factory Quality System</p>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            {isAuthenticated && (
              <>
                <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Dashboard
                </Link>
                <Link href="/history" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Lịch sử
                </Link>
                <Link href="/layout" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Layout
                </Link>
                <Link href="/api-docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  API Docs
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-3">
            {loading ? (
              <div className="h-9 w-24 bg-muted animate-pulse rounded-lg" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground hidden sm:block">
                  {user?.name || user?.email}
                </span>
                <Link href="/dashboard">
                  <Button variant="default" size="sm" className="gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Dashboard
                  </Button>
                </Link>
              </div>
            ) : (
              <a href={getLoginUrl()}>
                <Button variant="default" size="sm" className="gap-2">
                  <LogIn className="h-4 w-4" />
                  Đăng nhập
                </Button>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
        
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm text-primary font-medium">Hệ thống quản lý chất lượng thông minh</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              <span className="gradient-text">AVI/AOI</span>
              <br />
              <span className="text-foreground">Factory Management</span>
            </h1>
            
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Hệ thống quản lý và giám sát dữ liệu chất lượng sản xuất từ các máy AVI, AOI 
              và thiết bị tự động hóa trong nhà xưởng với giao diện hiện đại và phân tích AI.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {isAuthenticated ? (
                <>
                  <Link href="/dashboard">
                    <Button size="lg" className="gap-2 glow-primary">
                      <BarChart3 className="h-5 w-5" />
                      Xem Dashboard
                    </Button>
                  </Link>
                  <Link href="/api-docs">
                    <Button size="lg" variant="outline" className="gap-2">
                      <Cpu className="h-5 w-5" />
                      API Documentation
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <a href={getLoginUrl()}>
                    <Button size="lg" className="gap-2 glow-primary">
                      <LogIn className="h-5 w-5" />
                      Bắt đầu ngay
                    </Button>
                  </a>
                  <Link href="/api-docs">
                    <Button size="lg" variant="outline" className="gap-2">
                      <Cpu className="h-5 w-5" />
                      Xem API Docs
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 border-y border-border/50 bg-card/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 mb-3">
                  <span className="text-primary">{stat.icon}</span>
                </div>
                <div className="text-2xl md:text-3xl font-bold text-foreground">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 lg:py-28">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Tính năng <span className="gradient-text">nổi bật</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Hệ thống toàn diện để quản lý và giám sát chất lượng sản xuất với các công cụ mạnh mẽ
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="glass-card hover:border-primary/50 transition-all duration-300 group">
                <CardHeader>
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <span className="text-primary">{feature.icon}</span>
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-muted-foreground">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-primary/10 via-card to-accent/10">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Sẵn sàng nâng cao chất lượng sản xuất?
            </h2>
            <p className="text-muted-foreground mb-8">
              Kết nối máy AVI/AOI của bạn ngay hôm nay và bắt đầu theo dõi chất lượng sản xuất realtime
            </p>
            {isAuthenticated ? (
              <Link href="/settings">
                <Button size="lg" className="gap-2">
                  <Settings className="h-5 w-5" />
                  Cấu hình hệ thống
                </Button>
              </Link>
            ) : (
              <a href={getLoginUrl()}>
                <Button size="lg" className="gap-2 glow-primary">
                  <LogIn className="h-5 w-5" />
                  Đăng nhập để bắt đầu
                </Button>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/50">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">
                AVI/AOI Factory Management System
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025 All rights reserved
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
