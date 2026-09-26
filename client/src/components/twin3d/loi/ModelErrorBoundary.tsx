/**
 * ModelErrorBoundary.tsx — MỘT MODEL HỎNG KHÔNG ĐƯỢC LÀM SẬP CẢNH (#4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẢI LÀ ErrorBoundary CHỨ KHÔNG PHẢI try/catch
 * ════════════════════════════════════════════════════════════════════════════
 * `GLTFLoader` nạp BẤT ĐỒNG BỘ và `useLoader`/`React.lazy` báo lỗi bằng cách
 * NÉM TRONG LÚC RENDER (suspense throw-to-render). Một `try/catch` quanh lời gọi
 * nạp không bắt được nó — lỗi nổ ở lượt render sau, ngoài phạm vi khối try.
 * React chỉ cho một đường bắt hợp lệ: error boundary.
 *
 * Và hậu quả của việc KHÔNG bắt trong R3F nặng hơn ở DOM: cây con bị unmount là
 * cả `<Canvas>`, tức người dùng mất TOÀN BỘ cảnh — 42 máy biến mất vì một tệp
 * 3D hỏng của MỘT máy. Đó chính là lý do §10B.3 dựng cơ chế rơi-về-khối.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ FALLBACK PHẢI LÀ ĐỐI TƯỢNG 3D, KHÔNG PHẢI DOM
 * ════════════════════════════════════════════════════════════════════════════
 * Boundary này sống BÊN TRONG `<Canvas>`. R3F reconciler chỉ nhận phần tử của
 * three (`mesh`, `group`, …); trả `<div>` từ đây ném "Div is not part of the
 * THREE namespace" và biến một lỗi nạp thành lỗi thứ hai. Nên `fallback` mặc
 * định là `null` và người gọi truyền vào một khối thủ tục.
 *
 * ★ KHOÁ RESET (`khoaLamMoi`): boundary React KHÔNG tự thử lại. Nếu người dùng
 *   tải lên một tệp MỚI cho cùng máy đó, không có khoá này thì máy đó ở nguyên
 *   trạng thái hỏng cho tới khi reload trang — người dùng đã sửa xong lỗi mà
 *   màn hình vẫn khai là hỏng.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ModelErrorBoundaryProps {
  children: ReactNode;
  /**
   * Vẽ gì khi model hỏng. PHẢI là phần tử three (thường là khối thủ tục của
   * §10B.1), không phải DOM. Mặc định `null` = không vẽ gì, an toàn tuyệt đối.
   */
  fallback?: ReactNode;
  /**
   * Đổi giá trị này ⇒ boundary quên lỗi cũ và thử lại. Truyền `modelUri` là đủ:
   * URI mới nghĩa là tệp mới, và tệp mới xứng đáng một lần thử.
   */
  khoaLamMoi?: string | number | null;
  /** Báo ra ngoài để UI hiện huy hiệu "model hỏng" cạnh máy đó. */
  onLoi?: (loi: Error) => void;
  /** Nhãn cho log — thường là `machine:42`, để log nói rõ MÁY NÀO hỏng. */
  nhan?: string;
}

interface TrangThai {
  loi: Error | null;
  /** Khoá lúc lỗi được ghi nhận — so với prop để biết có nên thử lại không. */
  khoaLucLoi: string | number | null;
}

export class ModelErrorBoundary extends Component<ModelErrorBoundaryProps, TrangThai> {
  constructor(props: ModelErrorBoundaryProps) {
    super(props);
    this.state = { loi: null, khoaLucLoi: props.khoaLamMoi ?? null };
  }

  static getDerivedStateFromError(loi: Error): Partial<TrangThai> {
    return { loi };
  }

  /**
   * ★ Reset theo khoá phải làm ở `getDerivedStateFromProps`, KHÔNG ở
   *   `componentDidUpdate`. Ở `componentDidUpdate` thì lượt render NGAY SAU khi
   *   khoá đổi vẫn hiện fallback rồi mới thử lại ở lượt kế — một khung hình nhấp
   *   nháy mà không ai gỡ được vì nó đúng theo vòng đời.
   */
  static getDerivedStateFromProps(
    props: ModelErrorBoundaryProps,
    state: TrangThai,
  ): Partial<TrangThai> | null {
    const khoa = props.khoaLamMoi ?? null;
    if (state.loi !== null && khoa !== state.khoaLucLoi) {
      return { loi: null, khoaLucLoi: khoa };
    }
    if (state.loi === null && khoa !== state.khoaLucLoi) {
      return { khoaLucLoi: khoa };
    }
    return null;
  }

  componentDidCatch(loi: Error, thongTin: ErrorInfo): void {
    // ⚠ CỐ Ý `console.error` chứ không im lặng: một model hỏng câm là thứ không
    //   ai sửa. Nhưng nó KHÔNG ném tiếp — cảnh phải sống.
    console.error(
      `[twin3d] model 3D hỏng${this.props.nhan ? ` (${this.props.nhan})` : ""}:`,
      loi.message,
      thongTin.componentStack,
    );
    this.props.onLoi?.(loi);
  }

  render(): ReactNode {
    if (this.state.loi !== null) return this.props.fallback ?? null;
    return this.props.children;
  }
}

export default ModelErrorBoundary;
