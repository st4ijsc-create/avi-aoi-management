import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Keyboard, X, QrCode, Barcode, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface BarcodeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (serialNumber: string) => void;
}

export default function BarcodeScanner({ open, onOpenChange, onScan }: BarcodeScannerProps) {
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [manualInput, setManualInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrcodeRef = useRef<any>(null);

  // Initialize scanner when dialog opens
  useEffect(() => {
    if (open && mode === "camera") {
      initializeScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [open, mode]);

  const initializeScanner = async () => {
    try {
      setError(null);
      setIsScanning(true);
      
      // Dynamically import html5-qrcode
      const { Html5Qrcode } = await import("html5-qrcode");
      
      if (!scannerRef.current) return;
      
      // Create scanner instance
      const scannerId = "barcode-scanner-region";
      
      // Check if element exists
      if (!document.getElementById(scannerId)) {
        const scannerDiv = document.createElement("div");
        scannerDiv.id = scannerId;
        scannerRef.current.appendChild(scannerDiv);
      }
      
      html5QrcodeRef.current = new Html5Qrcode(scannerId);
      
      // Get available cameras
      const cameras = await Html5Qrcode.getCameras();
      
      if (cameras && cameras.length > 0) {
        // Prefer back camera
        const backCamera = cameras.find(c => 
          c.label.toLowerCase().includes("back") || 
          c.label.toLowerCase().includes("rear") ||
          c.label.toLowerCase().includes("environment")
        );
        const cameraId = backCamera?.id || cameras[0].id;
        
        await html5QrcodeRef.current.start(
          cameraId,
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            aspectRatio: 1.5,
          },
          (decodedText: string) => {
            handleScanSuccess(decodedText);
          },
          (errorMessage: string) => {
            // Ignore scan errors (no QR found)
          }
        );
      } else {
        setError("Không tìm thấy camera. Vui lòng nhập thủ công.");
        setMode("manual");
      }
    } catch (err: any) {
      console.error("Scanner error:", err);
      if (err.name === "NotAllowedError") {
        setError("Quyền truy cập camera bị từ chối. Vui lòng cấp quyền hoặc nhập thủ công.");
      } else if (err.name === "NotFoundError") {
        setError("Không tìm thấy camera. Vui lòng nhập thủ công.");
      } else {
        setError("Không thể khởi động camera. Vui lòng nhập thủ công.");
      }
      setMode("manual");
    } finally {
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (html5QrcodeRef.current) {
        const state = html5QrcodeRef.current.getState();
        if (state === 2) { // SCANNING state
          await html5QrcodeRef.current.stop();
        }
        html5QrcodeRef.current = null;
      }
    } catch (err) {
      console.error("Error stopping scanner:", err);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    // Stop scanner after successful scan
    stopScanner();
    
    setScanResult(decodedText);
    toast.success(`Đã quét: ${decodedText}`);
    
    // Delay to show result before closing
    setTimeout(() => {
      onScan(decodedText);
      handleClose();
    }, 1000);
  };

  const handleManualSubmit = () => {
    if (!manualInput.trim()) {
      toast.error("Vui lòng nhập Serial Number");
      return;
    }
    
    setScanResult(manualInput.trim());
    onScan(manualInput.trim());
    handleClose();
  };

  const handleClose = () => {
    stopScanner();
    setScanResult(null);
    setManualInput("");
    setError(null);
    onOpenChange(false);
  };

  const switchMode = (newMode: "camera" | "manual") => {
    if (newMode === "manual") {
      stopScanner();
    }
    setMode(newMode);
    setError(null);
    setScanResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            Quét mã vạch / QR Code
          </DialogTitle>
          <DialogDescription>
            Quét mã vạch hoặc QR code để tra cứu nhanh Serial Number
          </DialogDescription>
        </DialogHeader>
        
        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "camera" ? "default" : "outline"}
            size="sm"
            onClick={() => switchMode("camera")}
            className="flex-1"
          >
            <Camera className="w-4 h-4 mr-2" />
            Camera
          </Button>
          <Button
            variant={mode === "manual" ? "default" : "outline"}
            size="sm"
            onClick={() => switchMode("manual")}
            className="flex-1"
          >
            <Keyboard className="w-4 h-4 mr-2" />
            Nhập thủ công
          </Button>
        </div>
        
        {/* Scanner Area */}
        {mode === "camera" && (
          <div className="space-y-4">
            {error ? (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">{error}</span>
                </div>
              </div>
            ) : (
              <div 
                ref={scannerRef}
                className="relative bg-black rounded-lg overflow-hidden aspect-video"
              >
                {isScanning && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-white text-sm">Đang khởi động camera...</div>
                  </div>
                )}
                {/* Scanner overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-64 h-40 border-2 border-white/50 rounded-lg">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary rounded-tl" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary rounded-tr" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary rounded-bl" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary rounded-br" />
                    </div>
                  </div>
                  {/* Scan line animation */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-56 h-0.5 bg-primary/70 animate-pulse" />
                </div>
              </div>
            )}
            
            <p className="text-sm text-muted-foreground text-center">
              Đưa mã vạch hoặc QR code vào khung hình để quét
            </p>
          </div>
        )}
        
        {/* Manual Input */}
        {mode === "manual" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serial-input">Serial Number</Label>
              <div className="flex gap-2">
                <Input
                  id="serial-input"
                  placeholder="Nhập Serial Number..."
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleManualSubmit();
                    }
                  }}
                  autoFocus
                />
                <Button onClick={handleManualSubmit}>
                  Tìm kiếm
                </Button>
              </div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Barcode className="w-4 h-4" />
                <span>Hoặc sử dụng máy quét mã vạch cầm tay</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Scan Result */}
        {scanResult && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Đã quét thành công</span>
            </div>
            <p className="mt-1 text-sm font-mono">{scanResult}</p>
          </div>
        )}
        
        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose}>
            <X className="w-4 h-4 mr-2" />
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
