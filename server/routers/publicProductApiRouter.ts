import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { isValidMasterKey } from "../_core/masterKey";
import * as db from "../db";
import { storageGet, resolveImageToDataUrl } from "../storage";
import { getDb } from "../db/connection";
import { eq, and, gte, lte, sql, inArray, isNotNull, desc, asc } from "drizzle-orm";
import {
  stations,
  machines,
  productInspections,
  measurementResults,
  measurementPointDefs,
  productModels,
} from "../../drizzle/schema";
// ★★★ 2026-08-18 — trục PHẠM VI NHÀ MÁY của lối đi MÁY. Toàn bộ lời khai (vì sao `masterKey` là
// toàn cục, vì sao hợp BA đường liên kết, vì sao ném thay vì trả rỗng) nằm ở docblock file dưới.
import {
  PHAM_VI_TOAN_CUC,
  congSanPhamTrongNhaMay,
  factoryIdCanThuHep,
  factoryIdCuaTram,
  phamViNhaMayCuaMay,
  sanPhamTrongNhaMay,
  tuChoiNgoaiPhamVi,
  type PhamViMayGoi,
} from "./publicProductScope";

/**
 * Extract image dimensions from a base64 data URI (JPEG or PNG).
 * Uses Node.js Buffer — reliable on server side.
 */
function extractImageDimensionsFromDataUri(dataUri: string): { width: number; height: number } | null {
  try {
    if (!dataUri.startsWith('data:image/')) return null;
    const base64Data = dataUri.split(',')[1];
    if (!base64Data) return null;

    const buf = Buffer.from(base64Data, 'base64');

    // PNG: bytes 0-7 = signature, IHDR at 8, width at 16, height at 20
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      for (let i = 2; i < buf.length - 9; i++) {
        if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (width > 0 && height > 0) return { width, height };
        }
      }
    }
  } catch (e) {
    console.warn('[PublicProductAPI] extractImageDimensionsFromDataUri error:', e);
  }
  return null;
}

// ============ PUBLIC PRODUCT API ROUTER (for third-party app integration) ============
// Cho phép ứng dụng bên thứ 3 truy xuất thông tin sản phẩm, ảnh mẫu và điểm đo
// Xác thực bằng masterKey, apiKey hoặc machineCode

/**
 * ★★★ 2026-08-18 — **XÁC THỰC ⇒ PHẠM VI**, không còn là hai việc rời nhau.
 *
 * ⚠⚠ HÌNH DẠNG LỖI CŨ, ghi lại để không ai dựng lại nó: hàm này TỪNG trả về `machine | null`, và
 * cả **tám** nơi gọi viết `await validateAccess(input);` rồi **vứt giá trị trả về đi**. Danh tính
 * đã nằm trong tay mà không ai dùng ⇒ mọi truy vấn phía sau chạy KHÔNG LỌC, và bất kỳ ai đọc được
 * **mã máy** in trên nhãn thiết bị đọc trọn danh mục sản phẩm/ảnh/điểm đo/thống kê của MỌI nhà máy.
 *
 * Kiểu trả về mới `PhamViMayGoi` làm cho lỗi ấy **không diễn đạt được nữa**: nó không phải một
 * `machine` để tiện tay bỏ qua mà là *"phạm vi bạn phải áp"*, và `factoryIdCanThuHep` là một
 * `switch` vét cạn nên một lối vào thứ tư quên xử lý sẽ làm `tsc` đỏ.
 *
 * ⚠ Cả ba lối vào đều lấy danh tính từ `input` — điều mà `phamViDocScan.ts` cấm với thủ tục có
 * `ctx`. Ở đây KHÔNG có `ctx.user`: người gọi là MÁY. Hai lối `masterKey`/`apiKey` trình một BÍ MẬT
 * (đối chiếu `timingSafeEqual` / `machines.apiKey`), nên chúng là xác thực thật.
 * ⚠⚠ Lối `machineCode` thì **KHÔNG**: mã máy nằm trên nhãn thiết bị, trong URL và trong file xuất.
 * Nó là ngưỡng vào THẤP NHẤT của bề mặt này. Bản vá này thu hẹp thiệt hại của nó xuống còn ĐÚNG
 * MỘT nhà máy, nhưng không biến nó thành một phép xác thực — quyết định bỏ hay giữ lối vào ấy
 * thuộc về chủ dự án (xem báo cáo kèm bản vá).
 */
async function validateAccess(input: {
  apiKey?: string;
  machineCode?: string;
  masterKey?: string;
}): Promise<PhamViMayGoi> {
  // Lối 1: Master API Key — TOÀN CỤC TƯỜNG MINH, không phải một nhánh mặc định.
  // `MASTER_API_KEY` là MỘT bí mật của cả bản triển khai; không có bảng nào buộc nó vào một nhà
  // máy (cơ chế khoá CÓ phạm vi là `api_keys` với `factoryCode`/`corporateCode` — cơ chế khác).
  // Tức không tồn tại nhà máy nào để thu hẹp về. Lời khai đầy đủ: `publicProductScope.ts`.
  if (input.masterKey) {
    if (isValidMasterKey(input.masterKey)) return PHAM_VI_TOAN_CUC;
    throw appError("UNAUTHORIZED", "INVALID_VALUE", { field: "masterKey" }, "Invalid master key");
  }
  // Lối 2: Machine API Key (bí mật) ⇒ phạm vi = nhà máy của máy ấy.
  if (input.apiKey) {
    const machine = await db.getMachineByApiKey(input.apiKey);
    if (!machine) throw appError("UNAUTHORIZED", "INVALID_VALUE", { field: "apiKey" }, "Invalid API key");
    return phamViNhaMayCuaMay(machine);
  }
  // Lối 3: Machine Code (KHÔNG phải bí mật) ⇒ vẫn thu hẹp về đúng nhà máy của máy ấy.
  if (input.machineCode) {
    const machine = await db.getMachineByCode(input.machineCode.trim());
    if (!machine) throw appError("UNAUTHORIZED", "INVALID_VALUE", { field: "machineCode" }, "Invalid machine code");
    return phamViNhaMayCuaMay(machine);
  }
  throw appError("UNAUTHORIZED", "FIELD_REQUIRED", { field: "masterKeyOrApiKeyOrMachineCode" }, "Either masterKey, apiKey, or machineCode must be provided");
}

/**
 * Cổng cho một sản phẩm ĐÃ phân giải. `factoryId === null` (toàn cục tường minh) ⇒ không làm gì —
 * đó là chiều DƯƠNG chống "vá quá tay thành chặn tất cả".
 *
 * Một hàm chứ không phải năm lần chép `if (…) throw`: năm bản chép là năm chỗ để một bản lệch, và
 * bản lỏng nhất sẽ quyết định ai thấy gì.
 */
async function chanSanPhamNgoaiPhamVi(
  product: { id: number; code: string },
  factoryId: number | null,
): Promise<void> {
  if (factoryId === null) return;
  if (await sanPhamTrongNhaMay(product.id, factoryId)) return;
  tuChoiNgoaiPhamVi("productModel", `product '${product.code}'`);
}

/**
 * Cổng cho một TRẠM đã phân giải, dùng chung bởi `getPointStatsByStation` và
 * `getPointImagesByStation`.
 *
 * ⚠ Kiểm trên `stations.lineId` (liên kết THẬT, `NOT NULL` + FK `ON DELETE RESTRICT`) chứ không
 * suy từ tập máy của trạm: một trạm CHƯA CÓ MÁY vẫn thuộc về một nhà máy xác định, và nếu phán
 * quyết theo tập máy thì trạm ấy sẽ tụt vào nhánh "0 máy ⇒ trả rỗng" — tức lại là một câu trả lời
 * rỗng IM LẶNG cho một lượt hỏi lẽ ra phải bị TỪ CHỐI.
 */
async function chanTramNgoaiPhamVi(
  station: { code: string; lineId: number },
  factoryId: number | null,
): Promise<void> {
  if (factoryId === null) return;
  if ((await factoryIdCuaTram(station)) === factoryId) return;
  tuChoiNgoaiPhamVi("station", `station '${station.code}'`);
}

const authInput = z.object({
  apiKey: z.string().optional(),
  machineCode: z.string().optional(),
  masterKey: z.string().optional(),
}).refine(data => data.apiKey || data.machineCode || data.masterKey, {
  message: "Either masterKey, apiKey, or machineCode must be provided",
});

export const publicProductApiRouter = router({
  // Lấy danh sách sản phẩm (có hỗ trợ tìm kiếm, phân trang)
  listProducts: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      search: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const products = await db.getProductModels({
        search: input.search,
        lifecycleStatus: input.lifecycleStatus,
        isActive: true,
        limit: input.limit,
        offset: input.offset,
        sortBy: "name",
        sortOrder: "asc",
        // ★ Cổng phạm vi ghép TRONG truy vấn (không lọc sau) — nếu lọc sau thì `limit`/`offset`
        //   sẽ trả về một trang thiếu hàng và `total` khai sai. `undefined` = toàn cục tường minh.
        congPhamVi: factoryId !== null ? congSanPhamTrongNhaMay(productModels.id, factoryId) : undefined,
      });

      return {
        success: true,
        // ⚠ 0 DÒNG IM LẶNG LÀ NÓI DỐI: một danh sách rỗng vì PHẠM VI trông y hệt một danh sách
        //   rỗng vì nhà máy chưa khai sản phẩm nào. Ô này là thứ duy nhất phân biệt được hai
        //   trạng thái ấy ở phía gọi. Nó CHỈ mang một boolean — không mang `filter` (đối tượng SQL
        //   drizzle có tham chiếu vòng ⇒ superjson chết `Converting circular structure to JSON`).
        scopeApplied: factoryId !== null,
        data: products.map(p => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          category: p.category,
          productLine: p.productLine,
          variant: p.variant,
          lifecycleStatus: p.lifecycleStatus,
          referenceImageUrl: p.referenceImageUrl,
          imageWidth: p.imageWidth,
          imageHeight: p.imageHeight,
          targetYieldRate: p.targetYieldRate,
          minYieldRate: p.minYieldRate,
        })),
        total: products.length,
      };
    }),

  // Lấy chi tiết sản phẩm theo code (bao gồm danh sách điểm đo)
  getProductByCode: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      code: z.string().min(1),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const product = await db.getProductModelByCode(input.code);
      if (!product) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.code}`);
      }
      await chanSanPhamNgoaiPhamVi(product, factoryId);

      const measurementPoints = await db.getMeasurementPointDefsByProductModel(product.id);

      // Auto-compute image dimensions from base64 data URI if DB has null values
      let imageWidth = product.imageWidth;
      let imageHeight = product.imageHeight;
      if ((!imageWidth || !imageHeight) && product.referenceImageUrl?.startsWith('data:image/')) {
        const dims = extractImageDimensionsFromDataUri(product.referenceImageUrl);
        if (dims) {
          imageWidth = dims.width;
          imageHeight = dims.height;
          console.log(`[PublicProductAPI] Auto-computed image dims for ${product.code}: ${dims.width}x${dims.height}`);
        }
      }

      // Return referenceImageUrl as a relative endpoint URL (not the raw base64 data)
      // so clients can fetch the binary image separately via /api/public/products/:code/reference-image-file
      const referenceImageUrl = product.referenceImageUrl?.startsWith('data:')
        ? `/api/public/products/${encodeURIComponent(product.code)}/reference-image-file`
        : product.referenceImageUrl;

      return {
        success: true,
        data: {
          product: {
            id: product.id,
            code: product.code,
            name: product.name,
            description: product.description,
            category: product.category,
            productLine: product.productLine,
            variant: product.variant,
            lifecycleStatus: product.lifecycleStatus,
            referenceImageUrl,
            imageWidth,
            imageHeight,
            targetYieldRate: product.targetYieldRate,
            minYieldRate: product.minYieldRate,
          },
          measurementPoints: measurementPoints.map(mp => ({
            id: mp.id,
            code: mp.code,
            name: mp.name,
            description: mp.description,
            measurementType: mp.measurementType,
            unit: mp.unit,
            lowerLimit: mp.lowerLimit,
            upperLimit: mp.upperLimit,
            nominalValue: mp.nominalValue,
            positionX: mp.positionX,
            positionY: mp.positionY,
            radius: mp.radius,
            normalizedX: mp.normalizedX ? Number(mp.normalizedX) : null,
            normalizedY: mp.normalizedY ? Number(mp.normalizedY) : null,
            normalizedRadius: mp.normalizedRadius ? Number(mp.normalizedRadius) : null,
            referenceImageUrl: mp.referenceImageUrl,
            cropWidth: mp.cropWidth,
            cropHeight: mp.cropHeight,
            orderIndex: mp.orderIndex,
            workstationId: mp.workstationId,
          })),
        },
      };
    }),

  // Lấy chi tiết sản phẩm theo ID
  getProductById: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      id: z.number(),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const product = await db.getProductModelById(input.id);
      if (!product) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.id}`);
      }
      await chanSanPhamNgoaiPhamVi(product, factoryId);

      const measurementPoints = await db.getMeasurementPointDefsByProductModel(product.id);

      // Auto-compute image dimensions from base64 data URI if DB has null values
      let imageWidth = product.imageWidth;
      let imageHeight = product.imageHeight;
      if ((!imageWidth || !imageHeight) && product.referenceImageUrl?.startsWith('data:image/')) {
        const dims = extractImageDimensionsFromDataUri(product.referenceImageUrl);
        if (dims) {
          imageWidth = dims.width;
          imageHeight = dims.height;
        }
      }

      const referenceImageUrl = product.referenceImageUrl?.startsWith('data:')
        ? `/api/public/products/${encodeURIComponent(product.code)}/reference-image-file`
        : product.referenceImageUrl;

      return {
        success: true,
        data: {
          product: {
            id: product.id,
            code: product.code,
            name: product.name,
            description: product.description,
            category: product.category,
            productLine: product.productLine,
            variant: product.variant,
            lifecycleStatus: product.lifecycleStatus,
            referenceImageUrl,
            imageWidth,
            imageHeight,
            targetYieldRate: product.targetYieldRate,
            minYieldRate: product.minYieldRate,
          },
          measurementPoints: measurementPoints.map(mp => ({
            id: mp.id,
            code: mp.code,
            name: mp.name,
            description: mp.description,
            measurementType: mp.measurementType,
            unit: mp.unit,
            lowerLimit: mp.lowerLimit,
            upperLimit: mp.upperLimit,
            nominalValue: mp.nominalValue,
            positionX: mp.positionX,
            positionY: mp.positionY,
            radius: mp.radius,
            normalizedX: mp.normalizedX ? Number(mp.normalizedX) : null,
            normalizedY: mp.normalizedY ? Number(mp.normalizedY) : null,
            normalizedRadius: mp.normalizedRadius ? Number(mp.normalizedRadius) : null,
            referenceImageUrl: mp.referenceImageUrl,
            cropWidth: mp.cropWidth,
            cropHeight: mp.cropHeight,
            orderIndex: mp.orderIndex,
            workstationId: mp.workstationId,
          })),
        },
      };
    }),

  // Lấy danh sách điểm đo của sản phẩm
  getMeasurementPoints: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      productCode: z.string().min(1),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const product = await db.getProductModelByCode(input.productCode);
      if (!product) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.productCode}`);
      }
      await chanSanPhamNgoaiPhamVi(product, factoryId);

      const points = await db.getMeasurementPointDefsByProductModel(product.id);

      return {
        success: true,
        imageWidth: product.imageWidth,
        imageHeight: product.imageHeight,
        data: points.map(mp => ({
          id: mp.id,
          code: mp.code,
          name: mp.name,
          description: mp.description,
          measurementType: mp.measurementType,
          unit: mp.unit,
          lowerLimit: mp.lowerLimit,
          upperLimit: mp.upperLimit,
          nominalValue: mp.nominalValue,
          positionX: mp.positionX,
          positionY: mp.positionY,
          radius: mp.radius,
          normalizedX: mp.normalizedX ? Number(mp.normalizedX) : null,
          normalizedY: mp.normalizedY ? Number(mp.normalizedY) : null,
          normalizedRadius: mp.normalizedRadius ? Number(mp.normalizedRadius) : null,
          referenceImageUrl: mp.referenceImageUrl,
          cropWidth: mp.cropWidth,
          cropHeight: mp.cropHeight,
          orderIndex: mp.orderIndex,
          workstationId: mp.workstationId,
        })),
        total: points.length,
      };
    }),

  // Lấy URL tải ảnh mẫu sản phẩm (reference image)
  getProductImage: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      productCode: z.string().min(1),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const product = await db.getProductModelByCode(input.productCode);
      if (!product) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.productCode}`);
      }
      await chanSanPhamNgoaiPhamVi(product, factoryId);

      if (!product.referenceImageUrl && !product.referenceImageKey) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "referenceImage" }, "Product has no reference image");
      }

      // Nếu có storageKey thì lấy URL tải từ storage, ngược lại trả về URL trực tiếp
      let downloadUrl = product.referenceImageUrl;
      if (product.referenceImageKey) {
        const result = await storageGet(product.referenceImageKey);
        downloadUrl = result.url;
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const imageUrl = await resolveImageToDataUrl(downloadUrl);

      // Auto-compute image dimensions if DB has null values
      let imageWidth = product.imageWidth;
      let imageHeight = product.imageHeight;
      if ((!imageWidth || !imageHeight) && imageUrl?.startsWith('data:image/')) {
        const dims = extractImageDimensionsFromDataUri(imageUrl);
        if (dims) {
          imageWidth = dims.width;
          imageHeight = dims.height;
        }
      }

      return {
        success: true,
        data: {
          productCode: product.code,
          productName: product.name,
          imageUrl,
          imageWidth,
          imageHeight,
        },
      };
    }),

  // Lấy URL tải ảnh mẫu điểm đo
  getPointImage: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      pointId: z.number().optional(),
      pointCode: z.string().optional(),
      productCode: z.string().optional(),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }).refine(data => data.pointId || (data.pointCode && data.productCode), {
      message: "Provide pointId, or both pointCode and productCode",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      let point;
      if (input.pointId) {
        point = await db.getMeasurementPointDefById(input.pointId);
      } else if (input.pointCode && input.productCode) {
        const product = await db.getProductModelByCode(input.productCode);
        if (!product) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.productCode}`);
        }
        await chanSanPhamNgoaiPhamVi(product, factoryId);
        point = await db.getMeasurementPointDefByCode(product.id, input.pointCode);
      }

      if (!point) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Measurement point not found");
      }

      // ⚠ Cổng phải đặt ở ĐÂY, không chỉ ở nhánh `productCode` phía trên: lối `pointId` bỏ qua
      //   hoàn toàn khối kia (`measurement_point_defs.id` là khoá TOÀN CỤC, không mang nhà máy),
      //   nên chỉ chặn ở nhánh kia là để nguyên một cửa sau mở toang. Điểm đo thuộc về sản phẩm,
      //   nên phán quyết theo `productModelId` — cùng vị từ mà danh sách dùng, không phải bản thứ hai.
      if (factoryId !== null && !(await sanPhamTrongNhaMay(point.productModelId, factoryId))) {
        tuChoiNgoaiPhamVi("measurementPoint", `measurement point '${point.code}'`);
      }

      if (!point.referenceImageUrl && !point.referenceImageKey) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "referenceImage" }, "Measurement point has no reference image");
      }

      let downloadUrl = point.referenceImageUrl;
      if (point.referenceImageKey) {
        const result = await storageGet(point.referenceImageKey);
        downloadUrl = result.url;
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const imageUrl = await resolveImageToDataUrl(downloadUrl);

      return {
        success: true,
        data: {
          pointId: point.id,
          pointCode: point.code,
          pointName: point.name,
          imageUrl,
          cropWidth: point.cropWidth,
          cropHeight: point.cropHeight,
        },
      };
    }),

  // ============ Thống kê điểm đo của sản phẩm theo trạm (station) ============
  getPointStatsByStation: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      stationCode: z.string().min(1),
      productCode: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Find station by code
      const station = await db.getStationByCode(input.stationCode);
      if (!station) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, `Station not found: ${input.stationCode}`);
      }
      await chanTramNgoaiPhamVi(station, factoryId);

      // Get machines in this station
      const stationMachines = await db.getMachinesByStation(station.id);
      const machineIds = stationMachines.filter(m => m.isActive).map(m => m.id);
      if (machineIds.length === 0) {
        return { success: true, scopeApplied: factoryId !== null, station: { id: station.id, code: station.code, name: station.name }, product: null, data: [], total: 0 };
      }

      // Build date filters
      const startDate = input.startDate ? new Date(input.startDate) : undefined;
      const endDate = input.endDate ? new Date(input.endDate) : undefined;

      // Determine product model (by code or most-used in station)
      let productModelId: number | null = null;
      let productInfo: { id: number; code: string; name: string } | null = null;

      if (input.productCode) {
        const product = await db.getProductModelByCode(input.productCode);
        if (!product) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.productCode}`);
        // ⚠ Trạm ĐÚNG nhà máy KHÔNG đủ: lối lùi bên dưới (`pointDefs` theo `productModelId` khi
        //   không có điểm đo nào gắn máy của trạm) đọc `measurement_point_defs` mà KHÔNG qua
        //   `machineId`, nên một `productCode` của nhà máy khác vẫn lộ trọn định nghĩa điểm đo.
        await chanSanPhamNgoaiPhamVi(product, factoryId);
        productModelId = product.id;
        productInfo = { id: product.id, code: product.code, name: product.name };
      } else {
        // Find the most inspected product model at this station
        const dateConds = [inArray(productInspections.machineId, machineIds)];
        if (startDate) dateConds.push(gte(productInspections.inspectionTime, startDate));
        if (endDate) dateConds.push(lte(productInspections.inspectionTime, endDate));

        const pmRows = await database.select({
          modelId: productInspections.productModelId,
          cnt: sql<number>`count(*)`.as('cnt'),
        })
          .from(productInspections)
          .where(and(...dateConds))
          .groupBy(productInspections.productModelId)
          .orderBy(desc(sql`cnt`))
          .limit(1);

        if (pmRows.length > 0 && pmRows[0].modelId) {
          productModelId = pmRows[0].modelId;
          const pm = await database.select({ id: productModels.id, code: productModels.code, name: productModels.name })
            .from(productModels).where(eq(productModels.id, productModelId)).limit(1);
          if (pm.length > 0) productInfo = pm[0];
        }
      }

      if (!productModelId) {
        return { success: true, scopeApplied: factoryId !== null, station: { id: station.id, code: station.code, name: station.name }, product: null, data: [], total: 0 };
      }

      // Get active measurement point defs for station machines or product model
      let pointDefs = await database.select()
        .from(measurementPointDefs)
        .where(and(
          inArray(measurementPointDefs.machineId, machineIds),
          eq(measurementPointDefs.isActive, true),
        ))
        .orderBy(asc(measurementPointDefs.orderIndex));

      if (pointDefs.length === 0) {
        pointDefs = await database.select()
          .from(measurementPointDefs)
          .where(and(
            eq(measurementPointDefs.productModelId, productModelId),
            eq(measurementPointDefs.isActive, true),
          ))
          .orderBy(asc(measurementPointDefs.orderIndex));
      }

      if (pointDefs.length === 0) {
        return { success: true, scopeApplied: factoryId !== null, station: { id: station.id, code: station.code, name: station.name }, product: productInfo, data: [], total: 0 };
      }

      const pointDefIds = pointDefs.map(p => p.id);

      // Build inspection date conditions
      const inspConds = [
        inArray(measurementResults.pointDefId, pointDefIds),
        inArray(productInspections.machineId, machineIds),
      ];
      if (startDate) inspConds.push(gte(productInspections.inspectionTime, startDate));
      if (endDate) inspConds.push(lte(productInspections.inspectionTime, endDate));

      // Per-point statistics
      const pointStats = await database.select({
        pointDefId: measurementResults.pointDefId,
        total: sql<number>`count(*)`.as('total'),
        ok: sql<number>`sum(case when ${measurementResults.result} = 'OK' then 1 else 0 end)`.as('ok'),
        ng: sql<number>`sum(case when ${measurementResults.result} = 'NG' then 1 else 0 end)`.as('ng'),
        minVal: sql<number>`min(${measurementResults.measuredValue}::numeric)`.as('minVal'),
        maxVal: sql<number>`max(${measurementResults.measuredValue}::numeric)`.as('maxVal'),
        avgVal: sql<number>`avg(${measurementResults.measuredValue}::numeric)`.as('avgVal'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...inspConds))
        .groupBy(measurementResults.pointDefId);

      const statsMap = new Map(pointStats.map(s => [s.pointDefId, s]));

      const data = pointDefs.map(def => {
        const st = statsMap.get(def.id);
        const total = st ? Number(st.total) : 0;
        const ok = st ? Number(st.ok) : 0;
        const ng = st ? Number(st.ng) : 0;
        const ngRate = total > 0 ? Math.round((ng / total) * 10000) / 100 : 0;

        return {
          pointDefId: def.id,
          pointCode: def.code,
          pointName: def.name,
          measurementType: def.measurementType,
          unit: def.unit,
          lowerLimit: def.lowerLimit != null ? Number(def.lowerLimit) : null,
          upperLimit: def.upperLimit != null ? Number(def.upperLimit) : null,
          nominalValue: def.nominalValue != null ? Number(def.nominalValue) : null,
          totalCount: total,
          okCount: ok,
          ngCount: ng,
          ngRate,
          minValue: st?.minVal != null ? Number(Number(st.minVal).toFixed(6)) : null,
          maxValue: st?.maxVal != null ? Number(Number(st.maxVal).toFixed(6)) : null,
          avgValue: st?.avgVal != null ? Number(Number(st.avgVal).toFixed(6)) : null,
        };
      });

      return {
        success: true,
        scopeApplied: factoryId !== null,
        station: { id: station.id, code: station.code, name: station.name },
        product: productInfo,
        startDate: input.startDate || null,
        endDate: input.endDate || null,
        data,
        total: data.length,
      };
    }),

  // ============ Lấy toàn bộ ảnh đo thực tế của điểm đo theo trạm ============
  getPointImagesByStation: publicProcedure
    .input(z.object({
      apiKey: z.string().optional(),
      machineCode: z.string().optional(),
      masterKey: z.string().optional(),
      stationCode: z.string().min(1),
      pointCode: z.string().min(1),
      productCode: z.string().optional(),
      resultFilter: z.enum(["ALL", "OK", "NG"]).default("ALL"),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).refine(data => data.apiKey || data.machineCode || data.masterKey, {
      message: "Either masterKey, apiKey, or machineCode must be provided",
    }))
    .query(async ({ input }) => {
      const factoryId = factoryIdCanThuHep(await validateAccess(input));

      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Find station
      const station = await db.getStationByCode(input.stationCode);
      if (!station) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, `Station not found: ${input.stationCode}`);
      }
      await chanTramNgoaiPhamVi(station, factoryId);

      // Get machines in station
      const stationMachines = await db.getMachinesByStation(station.id);
      const machineIds = stationMachines.filter(m => m.isActive).map(m => m.id);
      if (machineIds.length === 0) {
        return { success: true, scopeApplied: factoryId !== null, data: [], total: 0 };
      }

      // Resolve product model
      let productModelId: number | null = null;
      if (input.productCode) {
        const product = await db.getProductModelByCode(input.productCode);
        if (!product) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Product not found: ${input.productCode}`);
        await chanSanPhamNgoaiPhamVi(product, factoryId);
        productModelId = product.id;
      }

      // Find the measurement point def by code
      let pointDef;
      if (productModelId) {
        pointDef = await db.getMeasurementPointDefByCode(productModelId, input.pointCode);
      } else {
        // Find point from machines in this station
        const pointDefs = await database.select()
          .from(measurementPointDefs)
          .where(and(
            inArray(measurementPointDefs.machineId, machineIds),
            eq(measurementPointDefs.code, input.pointCode),
            eq(measurementPointDefs.isActive, true),
          ))
          .limit(1);
        pointDef = pointDefs.length > 0 ? pointDefs[0] : null;

        // Fallback: search by product model
        // ⚠⚠ ĐÂY là lượt đọc RỘNG NHẤT của cả router: nó tra `measurement_point_defs` chỉ bằng
        //    `code` — không nhà máy, không trạm, không sản phẩm. `code` KHÔNG duy nhất toàn hệ
        //    (chỉ mục là `(productModelId, code)`), nên một mã điểm đo phổ biến ("P01") sẽ trúng
        //    hàng của một nhà máy BẤT KỲ, rồi cả khối truy vấn ảnh phía dưới chạy trên hàng ấy.
        //    Cổng phạm vi phải nằm TRONG chính mệnh đề `where` — lọc sau khi `limit(1)` là vô
        //    nghĩa: hàng của nhà máy khác đã chiếm mất chỗ và kết quả thành rỗng IM LẶNG.
        if (!pointDef) {
          const pointDefsByProduct = await database.select()
            .from(measurementPointDefs)
            .where(and(
              eq(measurementPointDefs.code, input.pointCode),
              eq(measurementPointDefs.isActive, true),
              ...(factoryId !== null
                ? [congSanPhamTrongNhaMay(measurementPointDefs.productModelId, factoryId)]
                : []),
            ))
            .limit(1);
          pointDef = pointDefsByProduct.length > 0 ? pointDefsByProduct[0] : null;
        }
      }

      if (!pointDef) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, `Measurement point not found: ${input.pointCode}`);
      }

      // Build date/filter conditions
      const startDate = input.startDate ? new Date(input.startDate) : undefined;
      const endDate = input.endDate ? new Date(input.endDate) : undefined;

      const conds = [
        eq(measurementResults.pointDefId, pointDef.id),
        inArray(productInspections.machineId, machineIds),
        isNotNull(measurementResults.imageUrl),
      ];
      if (startDate) conds.push(gte(productInspections.inspectionTime, startDate));
      if (endDate) conds.push(lte(productInspections.inspectionTime, endDate));
      if (input.resultFilter === "OK") conds.push(eq(measurementResults.result, "OK"));
      if (input.resultFilter === "NG") conds.push(eq(measurementResults.result, "NG"));

      // Count total matching rows
      const countResult = await database.select({
        count: sql<number>`count(*)`.as('count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conds));

      const totalCount = Number(countResult[0]?.count || 0);

      // Fetch images with pagination
      const images = await database.select({
        id: measurementResults.id,
        imageUrl: measurementResults.imageUrl,
        result: measurementResults.result,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        serialNumber: productInspections.serialNumber,
        inspectionTime: productInspections.inspectionTime,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conds))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(input.limit)
        .offset(input.offset);

      const data = images.map(img => ({
        id: img.id,
        imageUrl: img.imageUrl!,
        result: img.result,
        measuredValue: img.measuredValueText || (img.measuredValue != null ? String(img.measuredValue) : null),
        serialNumber: img.serialNumber || '',
        inspectionTime: img.inspectionTime ? new Date(img.inspectionTime).toISOString() : null,
      }));

      return {
        success: true,
        scopeApplied: factoryId !== null,
        point: {
          id: pointDef.id,
          code: pointDef.code,
          name: pointDef.name,
          measurementType: pointDef.measurementType,
        },
        station: { id: station.id, code: station.code, name: station.name },
        data,
        total: totalCount,
        limit: input.limit,
        offset: input.offset,
      };
    }),
});
